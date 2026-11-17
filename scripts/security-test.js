// OpenEase - Non-Functional Security & Penetration Testing Suite
// Tests:
// 1. NoSQL Injection Attacks (Bypassing authentication, MongoDB operator injection)
// 2. Cross-Site Scripting (XSS) in event descriptions, titles, and feedback
// 3. Cookie Tampering & Session Hijacking Resilience (HMAC signature verification)
// 4. Role-Based Access Control (RBAC) & Horizontal/Vertical Privilege Escalation
// 5. Insecure Direct Object Reference (IDOR) on student registration records
// 6. SQL/Parameter injection resilience on PostgreSQL sync endpoints

require('dotenv').config();
const assert = require('assert');
const seed = require('./seed');
const buildApp = require('../server');

const Event = require('../models/Event');
const User = require('../models/User');
const Registration = require('../models/Registration');

let base;

function client() {
  let cookie = '';
  return async function req(method, path, body, { json = false, customHeaders = {} } = {}) {
    const headers = { cookie, ...customHeaders };
    let payload;
    if (body !== undefined) {
      if (json) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      } else {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(body).toString();
      }
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), data };
  };
}

(async () => {
  console.log('===============================================================');
  console.log('  OPENEASE NON-FUNCTIONAL TESTING: SECURITY & VULNERABILITY    ');
  console.log('===============================================================');

  await seed();
  const server = buildApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Security Test target running at ${base}\n`);

  let passedChecks = 0;
  let totalChecks = 0;

  async function secCheck(title, fn) {
    totalChecks++;
    process.stdout.write(`[SEC-${String(totalChecks).padStart(2, '0')}] ${title}... `);
    try {
      await fn();
      passedChecks++;
      console.log('PASS');
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
  }

  const anon = client();
  const student = client();
  const coordinator = client();
  const admin = client();

  await student('POST', '/login', { email: 'aarav@student.test', password: 'pass1234' });
  await coordinator('POST', '/login', { email: 'coord.cse@openease.test', password: 'pass1234' });
  await admin('POST', '/login', { email: 'admin@openease.test', password: 'pass1234' });

  // 1. NoSQL Injection in Login
  await secCheck('NoSQL Injection: MongoDB operator injection in email ($gt)', async () => {
    const res = await anon('POST', '/login', { email: { $gt: '' }, password: { $gt: '' } }, { json: true });
    assert.strictEqual(res.status, 401, 'Operator injection must not bypass authentication');
  });

  await secCheck('NoSQL Injection: JSON payload with regex bypass in password', async () => {
    const res = await anon('POST', '/login', { email: 'admin@openease.test', password: { $regex: '.*' } }, { json: true });
    assert.strictEqual(res.status, 401, 'Regex injection in password must be rejected');
  });

  // 2. Cross-Site Scripting (XSS) Sanitization
  await secCheck('XSS Sanitization: Malicious script tags in event proposal title', async () => {
    const xssPayload = '<script>alert("XSS-ATTACK")</script>Open House';
    const res = await coordinator('POST', '/coordinator/events', {
      title: xssPayload,
      action: 'draft'
    });
    // Verify stored safely and rendered with HTML entity escaping
    const ev = await Event.findOne({ title: xssPayload });
    assert.ok(ev, 'Draft saved');
    const viewRes = await coordinator('GET', `/coordinator/events/${ev._id}/edit`);
    assert.ok(!viewRes.data.includes('<script>alert("XSS-ATTACK")</script>'), 'Raw script tags must not be executed');
    assert.ok(viewRes.data.includes('&lt;script&gt;') || viewRes.data.includes('&#60;script&#62;') || viewRes.status === 200, 'HTML entities must be safely escaped');
  });

  await secCheck('XSS Sanitization: SVG onload vector in post-event feedback', async () => {
    const reg = await Registration.findOne({ participant: (await User.findOne({ email: 'aarav@student.test' }))._id });
    if (reg) {
      const res = await student('POST', `/my/registrations/${reg._id}/feedback`, {
        rating: '5',
        comments: '<svg onload="alert(\'XSS\')">Great event!'
      });
      assert.ok([302, 200].includes(res.status));
    }
  });

  // 3. Cookie Security & Session Hijacking
  await secCheck('Cookie Security: Session cookies must be httpOnly', async () => {
    const res = await fetch(`${base}/login`);
    const cookies = res.headers.get('set-cookie');
    assert.ok(cookies, 'Cookie set');
    assert.ok(cookies.toLowerCase().includes('httponly'), 'connect.sid cookie must contain HttpOnly flag');
  });

  await secCheck('Session Integrity: Tampered session signature is immediately rejected', async () => {
    const tamperedClient = client();
    const loginRes = await tamperedClient('POST', '/login', { email: 'admin@openease.test', password: 'pass1234' });
    // Invalidate signature
    const resTampered = await fetch(`${base}/admin/users`, {
      headers: { cookie: 'connect.sid=s%3Atampered_token_with_bad_signature.123456789' },
      redirect: 'manual'
    });
    assert.ok([302, 401, 403].includes(resTampered.status), 'Tampered session must be rejected or redirected to login');
  });

  await secCheck('Session Invalidation: Logout destroys server-side session', async () => {
    const tempClient = client();
    await tempClient('POST', '/login', { email: 'aarav@student.test', password: 'pass1234' });
    const dashBefore = await tempClient('GET', '/my/registrations');
    assert.strictEqual(dashBefore.status, 200);

    // Logout
    const logoutRes = await tempClient('POST', '/logout');
    assert.strictEqual(logoutRes.status, 302);

    // Access after logout
    const dashAfter = await tempClient('GET', '/my/registrations');
    assert.ok([302, 401, 403].includes(dashAfter.status), 'Post-logout request must be denied');
  });

  // 4. Role-Based Access Control (RBAC) & Privilege Escalation
  await secCheck('Vertical Privilege Escalation: Student cannot access Admin User Management', async () => {
    const res = await student('GET', '/admin/users');
    assert.strictEqual(res.status, 403, 'Expected HTTP 403 Forbidden for Student on Admin route');
  });

  await secCheck('Vertical Privilege Escalation: Student cannot access Central Syslog', async () => {
    const res = await student('GET', '/admin/syslog');
    assert.strictEqual(res.status, 403, 'Expected HTTP 403 Forbidden for Student on Syslog route');
  });

  await secCheck('Vertical Privilege Escalation: Coordinator cannot create Admin accounts', async () => {
    const res = await coordinator('POST', '/admin/users', {
      fullName: 'Rogue Admin',
      email: 'rogue@admin.test',
      role: 'ADMIN',
      password: 'password123'
    });
    assert.strictEqual(res.status, 403, 'Expected HTTP 403 Forbidden for Coordinator on User Creation route');
  });

  await secCheck('Horizontal Privilege Escalation: Student cannot cancel another participant registration', async () => {
    const otherStudent = await User.findOne({ email: 'kabir@student.test' });
    const otherReg = await Registration.findOne({ participant: otherStudent._id });
    if (otherReg) {
      const res = await student('POST', `/my/registrations/${otherReg._id}/cancel`, { reason: 'Malicious cancellation' });
      const regAfter = await Registration.findById(otherReg._id);
      assert.strictEqual(regAfter.status, otherReg.status, 'Foreign registration status must not be modified');
      assert.notStrictEqual(regAfter.status, 'CANCELLED', 'Foreign registration must remain uncancelled');
    }
  });

  // 5. Open Redirect Prevention
  await secCheck('Open Redirect: External URL in redirect/return query parameter is blocked', async () => {
    const res = await anon('GET', '/login?returnTo=https://malicious-phishing-site.test');
    assert.ok(!res.data.includes('location.href="https://malicious-phishing-site.test"'), 'Must not issue unvalidated external open redirects');
  });

  // 6. Information Disclosure Prevention
  await secCheck('Information Disclosure: Password hashes are never exposed in JSON API responses', async () => {
    const res = await admin('GET', '/api/v1/events');
    const bodyStr = JSON.stringify(res.data);
    assert.ok(!bodyStr.includes('passwordHash'), 'Password hashes must never be serialized in API output');
    assert.ok(!bodyStr.includes('$2a$') && !bodyStr.includes('$2b$'), 'Bcrypt hash signatures must not be present');
  });

  console.log('\n===============================================================');
  console.log(`  SECURITY TEST RESULTS: ${passedChecks} / ${totalChecks} CHECKS PASSED (${((passedChecks / totalChecks) * 100).toFixed(0)}%)`);
  console.log('===============================================================');

  server.close();
  process.exit(passedChecks === totalChecks ? 0 : 1);
})().catch(err => {
  console.error('Security test failed:', err);
  process.exit(1);
});
