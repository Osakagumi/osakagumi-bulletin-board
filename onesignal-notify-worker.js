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
 * 2026年9月：以前は通知に「タップした際に遷移させるURL」（chatUrl）を持たせていたが、
 * PWAとしてインストールした環境で、通知をタップするたびにアプリのウィンドウが
 * 新規に増え続けてしまう問題が解決できなかったため、リンクを持たせるのをやめた。
 * これに伴い、chatUrlの受け取り・OneSignalへの送信（urlフィールド）を廃止している。
 * 通知はタップしても画面遷移はせず、消えるだけになる。
 */

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

    const recipientEmail = (body.recipientEmail || "").trim();
    const senderName = (body.senderName || "").trim();
    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: "recipientEmail is required" }), {
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
          // タップしても画面遷移はしないため、「タップして開く」という案内は避ける
          contents: { en: "社内ポータルのチャットをご確認ください" },
          // 2026年9月：urlフィールドを廃止（PWAでウィンドウが増え続ける問題のため）。
          // 通知はタップしても画面遷移せず、消えるだけになる。
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
