<?php
/**
 * HVBS AI Wallet — Email Notification Endpoint (SMTP Version, WITH DEBUG LOGGING)
 * Upload to: public_html/send-report.php
 *
 * ⚠️ IMPORTANT — READ BEFORE UPLOADING:
 * 1. Change your SMTP password on Hostinger RIGHT NOW if you shared this file
 *    or its old version anywhere (chat, GitHub, etc). Then put the NEW
 *    password below.
 * 2. This version returns the full SMTP conversation ("smtp_log") in the
 *    JSON response so you can see EXACTLY what the mail server said.
 *    Once delivery is confirmed working, set DEBUG_MODE to false so you
 *    stop exposing server internals to anyone who calls this endpoint.
 * 3. Delete debug-mail.php and test-send.php from your server — they are
 *    public, unauthenticated, and currently leak your SMTP credentials'
 *    validity (and in test-send.php's case, freely trigger mail sends).
 */

// ═══════════════════════════════════════════════════
//   APNA NAYA PASSWORD YAHAN LIKHO (purana ab safe nahi hai)  ↓
// ═══════════════════════════════════════════════════
define('SMTP_PASS', 'PUT_YOUR_NEW_ROTATED_PASSWORD_HERE');
// ═══════════════════════════════════════════════════

define('SMTP_HOST',  'smtp.hostinger.com');
define('SMTP_PORT',  465);
define('SMTP_USER',  'support@hvbsai.com');
define('FROM_NAME',  'HVBS AI Wallet');
define('DEBUG_MODE', true); // set to false once mail delivery is confirmed working

// CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit();
}

$data = json_decode(file_get_contents('php://input'), true);
if (!$data || empty($data['email'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing email']);
    exit();
}
$toEmail = filter_var(trim($data['email']), FILTER_VALIDATE_EMAIL);
if (!$toEmail) { http_response_code(400); echo json_encode(['error' => 'Invalid email']); exit(); }

$txType      = htmlspecialchars($data['txType']      ?? 'UNKNOWN', ENT_QUOTES, 'UTF-8');
$amount      = htmlspecialchars($data['amount']      ?? '',         ENT_QUOTES, 'UTF-8');
$recipient   = htmlspecialchars($data['recipient']   ?? '',         ENT_QUOTES, 'UTF-8');
$hash        = htmlspecialchars($data['hash']        ?? '',         ENT_QUOTES, 'UTF-8');
$networkName = htmlspecialchars($data['networkName'] ?? 'Robinhood Chain', ENT_QUOTES, 'UTF-8');
$explorerUrl = isset($data['explorerUrl']) ? filter_var($data['explorerUrl'], FILTER_VALIDATE_URL) : false;

$typeEmojis = ['SEND'=>'📤','SWAP'=>'🔄','BRIDGE'=>'🌉','TEST'=>'🧪'];
$typeLabels = ['SEND'=>'Transaction Sent','SWAP'=>'Token Swap','BRIDGE'=>'Cross-Chain Bridge','TEST'=>'Test Notification'];
$emoji     = $typeEmojis[$txType] ?? '💼';
$typeLabel = $typeLabels[$txType] ?? $txType;
$subject   = "HVBS Wallet: {$emoji} {$typeLabel}";

$explorerBtn  = $explorerUrl
    ? "<a href='{$explorerUrl}' style='display:inline-block;margin-top:14px;background:#c1ff00;color:#050b1a;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;'>View on Explorer &#x2197;</a>"
    : "";
$hashRow      = $hash
    ? "<tr><td style='padding:8px 0;color:#94a3b8;'>Hash</td><td style='padding:8px 0;font-family:monospace;font-size:0.78rem;word-break:break-all;'>{$hash}</td></tr>"
    : "";
$recipientRow = ($recipient && $recipient !== 'test@self')
    ? "<tr><td style='padding:8px 0;color:#94a3b8;'>Recipient</td><td style='padding:8px 0;font-family:monospace;font-size:0.78rem;word-break:break-all;'>{$recipient}</td></tr>"
    : "";

$boundary = md5(uniqid('hvbs', true));
$htmlBody = <<<HTML
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a1020;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1020;padding:30px 10px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:rgba(30,41,59,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#0d1b36,#1a2744);padding:28px 32px;text-align:center;border-bottom:1px solid rgba(193,255,0,0.2);">
    <div style="display:inline-block;background:#050b1a;border:2px solid #c1ff00;border-radius:50%;width:48px;height:48px;line-height:48px;font-size:1.2rem;font-weight:700;color:#c1ff00;text-align:center;margin-bottom:10px;">H</div>
    <div style="color:#f1f5f9;font-size:1.25rem;font-weight:700;">HVBS AI Wallet</div>
    <div style="color:#94a3b8;font-size:0.8rem;">Transaction Notification</div>
  </td></tr>
  <tr><td style="padding:24px 32px 0;">
    <div style="background:rgba(193,255,0,0.08);border:1px solid rgba(193,255,0,0.25);border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
      <div style="font-size:2rem;margin-bottom:6px;">{$emoji}</div>
      <div style="font-size:1rem;font-weight:700;color:#c1ff00;margin-bottom:4px;">{$typeLabel}</div>
      <div style="font-size:1.4rem;font-weight:700;color:#f1f5f9;">{$amount}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:0.85rem;color:#f1f5f9;">
      {$hashRow}{$recipientRow}
      <tr><td style="padding:8px 0;color:#94a3b8;">Network</td><td style="padding:8px 0;font-weight:600;">{$networkName}</td></tr>
    </table>
    {$explorerBtn}
  </td></tr>
  <tr><td style="padding:20px 32px 28px;border-top:1px solid rgba(255,255,255,0.07);margin-top:20px;">
    <p style="margin:0;font-size:0.72rem;color:#475569;line-height:1.5;">
      HVBS AI Wallet transaction alert. Agar aapne yeh transaction nahi ki toh wallet turant secure karein.
    </p>
  </td></tr>
</table></td></tr></table>
</body></html>
HTML;

$plainText = "{$emoji} {$typeLabel}\nAmount: {$amount}\nNetwork: {$networkName}"
           . ($hash ? "\nHash: {$hash}" : "")
           . ($recipient && $recipient !== 'test@self' ? "\nRecipient: {$recipient}" : "")
           . ($explorerUrl ? "\nExplorer: {$explorerUrl}" : "")
           . "\n\n-- HVBS AI Wallet";

// ── SMTP Sender (now returns full transcript) ──────────────────────
function smtp_send_email(string $to, string $subject, string $htmlBody, string $plainText, string $boundary): array {
    $transcript = [];
    $log = function(string $label, string $text) use (&$transcript) {
        $transcript[] = "$label: " . trim($text);
    };

    $ctx = stream_context_create(['ssl' => [
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ]]);

    $sock = @stream_socket_client(
        "ssl://" . SMTP_HOST . ":" . SMTP_PORT,
        $errno, $errstr, 15,
        STREAM_CLIENT_CONNECT, $ctx
    );
    if (!$sock) throw new RuntimeException("Connection failed: {$errstr} ({$errno})");
    stream_set_timeout($sock, 15);

    $read = function(string $label = 'RESP') use ($sock, &$transcript, $log): string {
        $buf = '';
        while ($line = fgets($sock, 512)) {
            $buf .= $line;
            if (strlen($line) >= 4 && $line[3] === ' ') break;
        }
        $log($label, $buf);
        $code = (int) substr($buf, 0, 3);
        if ($code >= 400) throw new RuntimeException("SMTP error: " . trim($buf));
        return $buf;
    };
    $cmd = function(string $c, string $label = 'CMD') use ($sock, $read, $log): string {
        // Don't log raw password bytes even base64-encoded, for safety
        $displayC = (stripos($label, 'AUTH') !== false && $label !== 'AUTH LOGIN') ? '[credential hidden]' : $c;
        $log($label . ' >>', $displayC);
        fwrite($sock, $c . "\r\n");
        return $read($label . ' <<');
    };

    $read('GREETING');
    $cmd("EHLO hvbsai.com", 'EHLO');
    $cmd("AUTH LOGIN", 'AUTH LOGIN');
    $cmd(base64_encode(SMTP_USER), 'AUTH USER');
    $cmd(base64_encode(SMTP_PASS), 'AUTH PASS');
    $cmd("MAIL FROM:<" . SMTP_USER . ">", 'MAIL FROM');
    $cmd("RCPT TO:<{$to}>", 'RCPT TO');
    $cmd("DATA", 'DATA');

    $nameB64    = '=?UTF-8?B?' . base64_encode(FROM_NAME) . '?=';
    $subjectB64 = '=?UTF-8?B?' . base64_encode($subject)  . '?=';
    $messageId  = '<' . bin2hex(random_bytes(16)) . '@hvbsai.com>';

    $msg  = "Date: " . date('r') . "\r\n";
    $msg .= "Message-ID: {$messageId}\r\n";
    $msg .= "From: {$nameB64} <" . SMTP_USER . ">\r\n";
    $msg .= "Reply-To: " . SMTP_USER . "\r\n";
    $msg .= "To: {$to}\r\n";
    $msg .= "Subject: {$subjectB64}\r\n";
    $msg .= "MIME-Version: 1.0\r\n";
    $msg .= "X-Mailer: HVBS-AI-Wallet\r\n";
    $msg .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n\r\n";
    $msg .= "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" . $plainText . "\r\n";
    $msg .= "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n" . $htmlBody . "\r\n";
    $msg .= "--{$boundary}--\r\n";

    // Dot-stuffing (RFC 5321)
    $msg = preg_replace('/^\./m', '..', $msg);

    fwrite($sock, $msg . "\r\n.\r\n");
    $read('DATA-FINAL');   // this is the line that tells you "250 OK queued as ..." — the real proof of acceptance
    $cmd("QUIT", 'QUIT');
    fclose($sock);

    return ['messageId' => $messageId, 'transcript' => $transcript];
}

// ── Send & respond ─────────────────────────────────────────────────
try {
    $result = smtp_send_email($toEmail, $subject, $htmlBody, $plainText, $boundary);
    $response = [
        'success'   => true,
        'message'   => 'Email accepted by SMTP server (this does NOT guarantee inbox delivery — check smtp_log below for the queue confirmation line, then verify in webmail Sent folder and via mail-tester.com)',
        'messageId' => $result['messageId'],
    ];
    if (DEBUG_MODE) {
        $response['smtp_log'] = $result['transcript'];
    }
    echo json_encode($response);
} catch (RuntimeException $e) {
    http_response_code(500);
    $response = ['error' => $e->getMessage()];
    echo json_encode($response);
}
