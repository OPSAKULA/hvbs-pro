<?php
/**
 * HVBS Wallet — Mail Debug Tool
 * Upload to: public_html/api/debug-mail.php
 * Visit:     https://hvbsai.com/api/debug-mail.php
 * DELETE this file after debugging is done!
 */

header("Content-Type: text/html; charset=UTF-8");

define('SMTP_HOST', 'smtp.hostinger.com');
define('SMTP_PORT', 465);
define('SMTP_USER', 'support@hvbsai.com');
define('SMTP_PASS', 'YOUR_EMAIL_PASSWORD_HERE'); // ← same password jo send-report.php mein dala
define('TEST_TO',   'support@hvbsai.com');       // ← jis email pe test bhejna hai

echo "<h2>HVBS Mail Debug</h2><pre>";

// Test 1: stream_socket_client available?
echo "✅ PHP Version: " . PHP_VERSION . "\n";
echo (function_exists('stream_socket_client') ? "✅" : "❌") . " stream_socket_client() available\n";
echo (function_exists('fsockopen')            ? "✅" : "❌") . " fsockopen() available\n";
echo (function_exists('mail')                 ? "✅" : "❌") . " mail() available\n\n";

// Test 2: SSL context
$context = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);

// Test 3: Try SMTP connect
echo "--- SMTP Connection Test (ssl://smtp.hostinger.com:465) ---\n";
$sock = @stream_socket_client(
    "ssl://" . SMTP_HOST . ":" . SMTP_PORT,
    $errno, $errstr, 10,
    STREAM_CLIENT_CONNECT,
    $context
);
if (!$sock) {
    echo "❌ SMTP connect FAILED: $errstr ($errno)\n";
    echo "   → Port 465 blocked by Hostinger firewall\n\n";

    // Try port 587
    echo "--- Trying port 587 (TLS) ---\n";
    $sock587 = @fsockopen("smtp.hostinger.com", 587, $errno587, $errstr587, 10);
    if ($sock587) {
        echo "✅ Port 587 is open! Use port 587 instead.\n";
        fclose($sock587);
    } else {
        echo "❌ Port 587 also failed: $errstr587\n";
    }
} else {
    $greeting = fgets($sock, 512);
    echo "✅ Connected! Server says: $greeting";

    // Try AUTH
    fwrite($sock, "EHLO hvbsai.com\r\n");
    $ehlo = '';
    while ($line = fgets($sock, 512)) {
        $ehlo .= $line;
        if ($line[3] === ' ') break;
    }
    echo "EHLO response:\n$ehlo\n";

    fwrite($sock, "AUTH LOGIN\r\n");
    $auth = fgets($sock, 512);
    echo "AUTH LOGIN: $auth";

    fwrite($sock, base64_encode(SMTP_USER) . "\r\n");
    $user = fgets($sock, 512);
    echo "Username response: $user";

    fwrite($sock, base64_encode(SMTP_PASS) . "\r\n");
    $pass = fgets($sock, 512);
    echo "Password response: $pass";

    $code = intval(substr($pass, 0, 3));
    if ($code === 235) {
        echo "\n✅ AUTH SUCCESS — SMTP credentials are correct!\n";
    } else {
        echo "\n❌ AUTH FAILED — Wrong password or account issue\n";
    }
    fwrite($sock, "QUIT\r\n");
    fclose($sock);
}

// Test 4: PHP mail()
echo "\n--- PHP mail() Test ---\n";
$headers  = "From: HVBS AI Wallet <" . SMTP_USER . ">\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$mailResult = @mail(TEST_TO, "HVBS Debug Test", "PHP mail() is working!", $headers);
echo ($mailResult ? "✅" : "❌") . " PHP mail() returned: " . ($mailResult ? "true" : "false") . "\n";

echo "\n--- Done ---\n";
echo "</pre>";
echo "<br><b style='color:red'>⚠️ DELETE this file from server after debugging!</b>";
