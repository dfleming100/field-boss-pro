export default function PrivacyPolicyPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#1e293b", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Privacy Policy for Field Boss Pro</h1>
      <p style={{ color: "#64748b", marginBottom: 32 }}>Effective Date: April 18, 2026</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>1. Introduction</h2>
      <p>Field Boss Pro ("we," "our," or "us") is operated by Fleming USA. This Privacy Policy explains how we collect, use, and protect information from users of our Field Boss Pro mobile application and web platform.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>2. Information We Collect</h2>
      <ul style={{ paddingLeft: 24 }}>
        <li>Business information (company name, address, contact details)</li>
        <li>User account information (name, email, phone number)</li>
        <li>Job and work order data entered by users</li>
        <li>Customer contact information entered by users</li>
        <li>Location data for technician dispatch (with permission)</li>
        <li>Payment information processed through Stripe (we do not store card details)</li>
        <li>Device information and app usage data</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>3. How We Use Your Information</h2>
      <ul style={{ paddingLeft: 24 }}>
        <li>To provide field service management features</li>
        <li>To send job notifications and appointment reminders via SMS and voice</li>
        <li>To process payments through Stripe Connect</li>
        <li>To improve our platform and customer support</li>
        <li>To communicate service updates</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>4. Data Sharing</h2>
      <p>We do not sell your data. We share data only with:</p>
      <ul style={{ paddingLeft: 24 }}>
        <li>Stripe (payment processing)</li>
        <li>Twilio (SMS communications)</li>
        <li>Supabase (secure data storage)</li>
        <li>Vapi (voice AI communications)</li>
      </ul>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>5. Data Security</h2>
      <p>We use industry-standard encryption and security practices to protect your data. All data is stored securely in Supabase with row-level security.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>6. Your Rights</h2>
      <p>You may request access, correction, or deletion of your data by contacting us at <a href="mailto:darryl@flemingusa.com" style={{ color: "#4f46e5" }}>darryl@flemingusa.com</a>.</p>

      <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, marginBottom: 8 }}>7. Contact Us</h2>
      <p>
        Fleming USA<br />
        <a href="mailto:darryl@flemingusa.com" style={{ color: "#4f46e5" }}>darryl@flemingusa.com</a><br />
        <a href="https://fieldbosspro.com" style={{ color: "#4f46e5" }}>fieldbosspro.com</a>
      </p>

      <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 48, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
        Field Boss Pro is a product of Fleming USA.
      </p>
    </div>
  );
}
