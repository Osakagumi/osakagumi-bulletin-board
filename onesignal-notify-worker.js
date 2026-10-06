/**
 * 大坂組社内ポータル：チャット新着通知プロキシ（Cloudflare Worker）
 *
 * 役割：
 *   Webアプリ（index.html）からのリクエストを受け取り、OneSignalのREST APIキーを
 *   秘密のまま（ブラウザに晒さず）、OneSignal側に通知送信を依頼する「代理人」。
 *   ブラウザからOneSignalのAPIを直接呼ぶとCORSでブロックされるため、
 *   この仕組みを間に挟んでいる。
 *
 * 必要な環境変数（Cloudflareダッシュボードの「設定」→「変数とシークレット」で設定）：
 *   ONESIGNAL_APP_ID       … OneSignalの「Settings > Keys & IDs」にあるApp ID
 *   ONESIGNAL_REST_API_KEY … 同じ画面にある「REST API Key」（これが今回の主役の秘密情報）
 *   SHARED_SECRET          … このWorkerを勝手に叩かれないようにするための合言葉（自分で決めてよい）
 *   ALLOWED_ORIGIN         … Webアプリの公開URL（例：https://osakagumi.github.io）
 *
 * 2026年10月（お知らせ新着通知を追加）：チャット通知（1人宛て）に加えて、お知らせ新着通知
 * （複数宛て）も、このWorkerで中継する。リクエストのbodyに type:"notice" が含まれる場合だけ
 * お知らせ用の処理になり、それ以外は従来どおりチャット通知として動く（既存の動作は変えない）。
 * お知らせ用は、①文面は常にWorker側の固定文（呼び出し側からは変えられない）、
 * ②遷移先URLもWorker側で決める（呼び出し側からは渡せない。通知から別サイトへ誘導されるのを防ぐ）、
 * ③宛先は1回あたり最大500人まで、としている。
 *
 * 2026年9月：一時的に通知のリンク（chatUrl）を廃止する変更を試したが、リンクを渡さない場合
 * OneSignal側が「Site URL」設定（ドメイン直下）へ飛ぼうとしてGitHub Pagesの実際の
 * 置き場所（サブフォルダ）と食い違い404になることが判明したため、元の「chatUrlを受け取り、
 * OneSignalのurlフィールドへ渡す」方式に戻した。
 */

// お知らせ新着通知の、1回のリクエストあたりの宛先上限（呼び出し側は200人ずつに分けて送る）
const MAX_NOTICE_RECIPIENTS = 500;
// お知らせ通知のタップ先（環境変数 PORTAL_APP_URL で上書き可能。通常は設定不要）
const DEFAULT_PORTAL_APP_URL = "https://osakagumi.github.io/osakagumi-bulletin-board/";

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ブラウザが本番リクエストの前に送ってくる確認リクエスト（プリフライト）への応答
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 合言葉チェック（このURLを知っているだけの第三者が、勝手に通知を送れないようにする）
    if (!env.SHARED_SECRET || body.secret !== env.SHARED_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ---- お知らせ新着通知（2026年10月追加）：宛先は複数、文面・遷移先はWorker側で固定 ----
    if (body.type === "notice") {
      const kind = body.kind === "update" ? "update" : "new";
      const rawList = Array.isArray(body.recipientEmails) ? body.recipientEmails : [];
      const recipientEmails = [...new Set(
        rawList.map((e) => String(e || "").trim()).filter((e) => e.includes("@"))
      )];
      if (recipientEmails.length === 0) {
        return new Response(JSON.stringify({ error: "recipientEmails is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      if (recipientEmails.length > MAX_NOTICE_RECIPIENTS) {
        return new Response(JSON.stringify({ error: "too many recipients" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const portalUrl = (env.PORTAL_APP_URL || DEFAULT_PORTAL_APP_URL).trim();
      const noticeUrl = `${portalUrl}${portalUrl.includes("?") ? "&" : "?"}tab=notices`;
      try {
        const oneSignalRes = await fetch("https://api.onesignal.com/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Basic ${env.ONESIGNAL_REST_API_KEY}`,
          },
          body: JSON.stringify({
            app_id: env.ONESIGNAL_APP_ID,
            include_aliases: { external_id: recipientEmails },
            target_channel: "push",
            // プライバシー上の理由から、お知らせのタイトル・本文は通知に含めない（固定文のみ）
            headings: { en: kind === "update" ? "お知らせが更新されました" : "新しいお知らせがあります" },
            contents: { en: "タップしてお知らせを開く" },
            url: noticeUrl,
            // Service Worker側（notificationclick）が、お知らせ通知だと判別するために使う
            data: { type: "notice", kind: kind },
          }),
        });
        const resultText = await oneSignalRes.text();
        return new Response(resultText, {
          status: oneSignalRes.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    const recipientEmail = (body.recipientEmail || "").trim();
    const senderName = (body.senderName || "").trim();
    const senderEmail = (body.senderEmail || "").trim();
    const chatUrl = (body.chatUrl || "").trim();
    if (!recipientEmail || !chatUrl) {
      return new Response(JSON.stringify({ error: "recipientEmail and chatUrl are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      const oneSignalRes = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": `Basic ${env.ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          app_id: env.ONESIGNAL_APP_ID,
          include_aliases: { external_id: [recipientEmail] },
          target_channel: "push",
          // プライバシー上の理由から、メッセージ本文は通知に含めない（誰からか、だけを伝える）
          headings: { en: `${senderName || "誰か"}さんからメッセージ` },
          contents: { en: "タップしてチャットを開く" },
          // 通知をタップした際に、該当のチャット画面へ直接遷移させる
          url: chatUrl,
          // Service Worker側（notificationclick）が、既に開いている画面に対して
          // 「どの相手とのチャットを開くか」をpostMessageで伝えるために使う
          data: { senderEmail: senderEmail },
        }),
      });

      const resultText = await oneSignalRes.text();
      return new Response(resultText, {
        status: oneSignalRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
};
