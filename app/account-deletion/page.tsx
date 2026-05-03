export const metadata = {
  title: "Account Deletion — Field Boss Pro",
  description:
    "How to request deletion of your Field Boss Pro account and the data associated with it.",
};

const H2: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginTop: 28, marginBottom: 8 };
const A: React.CSSProperties = { color: "#2563eb", textDecoration: "underline" };

export default function AccountDeletionPage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "40px 24px",
        fontFamily: "system-ui, sans-serif",
        color: "#1e293b",
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
        Account & Data Deletion
      </h1>
      <p style={{ color: "#64748b", marginBottom: 32 }}>
        Field Boss Pro · Updated May 3, 2026
      </p>

      <h2 style={H2}>How to request deletion</h2>
      <p>
        To permanently delete your Field Boss Pro account and the personal
        information associated with it, send an email to{" "}
        <a href="mailto:darryl@flemingusa.com" style={A}>
          darryl@flemingusa.com
        </a>{" "}
        with the subject line <strong>&quot;Delete my account&quot;</strong> from
        the email address registered to the account. We will confirm receipt
        within 2 business days and complete the deletion within 30 days.
      </p>

      <h2 style={H2}>What gets deleted</h2>
      <ul>
        <li>Your user profile (name, email, phone, role)</li>
        <li>Your authentication credentials</li>
        <li>Customer records and work orders you created</li>
        <li>SMS conversation history tied to your account</li>
        <li>Photos and attachments you uploaded</li>
        <li>GPS location history (technicians)</li>
        <li>Push notification tokens for your devices</li>
      </ul>

      <h2 style={H2}>What we may retain (and why)</h2>
      <p>
        Some records are retained for the periods below to meet legal, tax,
        accounting, and fraud-prevention obligations. These records are
        de-identified where possible:
      </p>
      <ul>
        <li>
          <strong>Invoice and payment records</strong> — up to 7 years (US tax
          and accounting requirements)
        </li>
        <li>
          <strong>Backup snapshots</strong> — up to 90 days, after which they
          age out automatically
        </li>
        <li>
          <strong>Aggregated, non-personal usage analytics</strong> —
          retained indefinitely (cannot be tied back to you)
        </li>
      </ul>

      <h2 style={H2}>Partial data deletion</h2>
      <p>
        If you only want a specific subset of your data removed (for example,
        a particular customer record, work order, or attachment) rather than
        the entire account, mention this in your request. We will scope the
        deletion to what you describe and confirm what was removed.
      </p>

      <h2 style={H2}>For tenant administrators</h2>
      <p>
        If you are the administrator of a tenant (an organization account)
        and request full deletion, please be aware that this will also remove
        the data of every technician, dispatcher, and customer record under
        that tenant. We will confirm scope with you before processing.
      </p>

      <h2 style={H2}>Questions</h2>
      <p>
        Questions about deletion or our broader privacy practices? See our{" "}
        <a href="/privacy-policy" style={A}>
          Privacy Policy
        </a>{" "}
        or email{" "}
        <a href="mailto:darryl@flemingusa.com" style={A}>
          darryl@flemingusa.com
        </a>
        .
      </p>
    </div>
  );
}
