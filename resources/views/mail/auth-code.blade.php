<!doctype html>
<html lang="en"><body style="margin:0;background:#f3f4f2;font-family:Arial,sans-serif;color:#111;padding:32px">
<div style="max-width:480px;margin:auto;background:#fff;padding:32px;border-top:6px solid #00ed95">
<h1 style="font-size:32px;letter-spacing:-2px">EDGE<span style="color:#00bd77">↗</span></h1>
<h2>{{ $purpose === 'register' ? 'Verify your email' : 'Confirm your sign-in' }}</h2>
<p>Enter this code on the EDGE verification screen:</p>
<p style="font-size:36px;font-weight:bold;letter-spacing:8px">{{ $code }}</p>
<p>Your code expires in 10 minutes and can only be used once. Never share it with anyone, including support.</p>
<p>If you didn’t request this code, you can ignore this email.</p>
</div></body></html>
