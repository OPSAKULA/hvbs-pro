<?php
/**
 * Direct mail test — visit this URL in browser to send test email
 * https://hvbsai.com/test-send.php
 * DELETE after testing!
 */

$to      = 'support@hvbsai.com'; // ← jis email pe test bhejni hai
$from    = 'support@hvbsai.com';
$subject = 'HVBS Direct Test - ' . date('H:i:s');
$message = 'Yeh test email hai. Agar yeh aa rahi hai toh PHP mail() kaam kar raha hai. Time: ' . date('d-m-Y H:i:s');
$headers = "From: HVBS Wallet <{$from}>\r\nReply-To: {$from}\r\nContent-Type: text/plain; charset=UTF-8";

$result = mail($to, $subject, $message, $headers);

echo "<h2>Mail Test Result</h2>";
echo "<p><b>Sent to:</b> {$to}</p>";
echo "<p><b>mail() returned:</b> " . ($result ? "<span style='color:green'>TRUE ✅</span>" : "<span style='color:red'>FALSE ❌</span>") . "</p>";
echo "<p><b>Time:</b> " . date('d-m-Y H:i:s') . "</p>";
echo "<hr><p style='color:red'><b>DELETE this file after testing!</b></p>";
