export const metadata = {
  title: "Privacy Policy — Field Boss Pro",
  description:
    "How Field Boss Pro collects, uses, shares, and protects your information.",
};

export default function PrivacyPolicyPage() {
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
        Privacy Policy for Field Boss Pro
      </h1>
      <p style={{ color: "#64748b", marginBottom: 32 }}>
        Effective Date: May 2, 2026
      </p>

      <h2 style={H2}>1. Who We Are</h2>
      <p>
        Field Boss Pro (&quot;Field Boss Pro,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a
        field-service management platform operated by Fleming USA. This Privacy
        Policy explains what information we collect through our mobile
        application and web platform (collectively, the &quot;Service&quot;), how we use
        and share it, and the choices you have.
      </p>
      <p>
        Field Boss Pro is intended for business use by service contractors and
        their staff. The Service is not directed to children under 13, and we
        do not knowingly collect personal information from children under 13.
      </p>

      <h2 style={H2}>2. Information We Collect</h2>
      <p>
        <strong>From you and your team (account holders and technicians):</strong>
      </p>
      <ul style={UL}>
        <li>Account information: name, email address, phone number, role.</li>
        <li>
          Business information: company name, address, service area ZIP codes,
          tax info needed to issue invoices.
        </li>
        <li>
          Authentication tokens managed by Supabase (we do not store passwords
          in plaintext).
        </li>
        <li>
          Device and app usage information: device type, OS version, app
          version, crash logs, and approximate session timestamps.
        </li>
        <li>
          Precise device location (only when you have a job assigned and you
          have granted location permission to the mobile app). Used to display
          technician position to dispatchers and to estimate arrival times.
        </li>
        <li>
          Photos and attachments you choose to upload from the camera or photo
          library to a work order.
        </li>
        <li>
          Push-notification tokens (so we can send you appointment and message
          alerts on your device).
        </li>
      </ul>

      <p>
        <strong>About your customers (entered by you, the contractor):</strong>
      </p>
      <ul style={UL}>
        <li>Customer name, service address, phone number(s), email.</li>
        <li>
          Work-order details, including appliance type, diagnosis, parts, and
          appointment scheduling information.
        </li>
        <li>
          Inbound and outbound SMS / MMS conversation history with your
          customers conducted through the Service.
        </li>
        <li>
          Voice-call metadata (call duration, status) for calls placed or
          received through our integrated voice features.
        </li>
        <li>
          Payment information processed through Stripe. We never see or store
          your customers&apos; full card numbers — Stripe handles card data and
          we receive only tokenized identifiers and transaction status.
        </li>
      </ul>

      <h2 style={H2}>3. How We Use Information</h2>
      <ul style={UL}>
        <li>Provide and operate the Service (job dispatch, scheduling, invoicing).</li>
        <li>
          Send appointment confirmations, reminders, and outreach SMS / voice
          calls to your customers on your behalf.
        </li>
        <li>Process payments through Stripe Connect.</li>
        <li>
          Sync work orders and statuses with the warranty programs you connect
          (e.g., First American Home Warranty, American Home Shield).
        </li>
        <li>
          Improve and secure the Service: prevent abuse, debug errors, monitor
          usage.
        </li>
        <li>
          Comply with legal obligations and respond to lawful requests.
        </li>
      </ul>

      <h2 style={H2}>4. Service Providers (Subprocessors)</h2>
      <p>
        We do <strong>not</strong> sell your data and we do not allow our
        subprocessors to use it for advertising. We share data with the
        following providers solely to operate the Service:
      </p>
      <ul style={UL}>
        <li>
          <strong>Supabase</strong> — primary database and authentication
          (United States).
        </li>
        <li>
          <strong>Vercel</strong> — application hosting and serverless
          functions (United States).
        </li>
        <li>
          <strong>Twilio</strong> — SMS, MMS, and voice telephony.
        </li>
        <li>
          <strong>Vapi</strong> — voice AI assistant for inbound and outbound
          customer calls.
        </li>
        <li>
          <strong>Anthropic</strong> — AI processing of inbound SMS messages
          to suggest replies and book appointments. Customer message content
          is sent to Anthropic for processing under their no-training data
          policy for API usage.
        </li>
        <li>
          <strong>Stripe</strong> — payment processing, including Tap to Pay
          on iPhone where supported.
        </li>
        <li>
          <strong>Resend</strong> — transactional email delivery.
        </li>
        <li>
          <strong>Google</strong> — geocoding addresses for routing and map
          display.
        </li>
        <li>
          <strong>First American Home Warranty (FAHW)</strong> and{" "}
          <strong>American Home Shield (AHS)</strong> — when you connect a
          warranty integration, we exchange work-order data with that
          warranty company on your behalf.
        </li>
        <li>
          <strong>Marcone Parts Supply</strong> and{" "}
          <strong>Reliable Parts</strong> — when you place parts orders
          through the Service, we exchange order data with the supplier.
        </li>
      </ul>
      <p>
        We may also share information when required by law, in connection with
        a corporate transaction (e.g., merger or acquisition), or to enforce
        our terms or protect our rights.
      </p>

      <h2 style={H2}>5. Data Retention</h2>
      <p>
        We retain account, work-order, and customer data for as long as your
        account is active and as needed to provide the Service. After you
        delete your account, we delete or de-identify your data within 30 days,
        except where we are required to retain it longer for legal,
        tax, or fraud-prevention reasons (typically up to 7 years for
        invoice and payment records).
      </p>
      <p>
        SMS and call conversation history is retained for as long as the
        related work order exists, plus the legal-retention window above.
      </p>

      <h2 style={H2}>6. Your Choices and Rights</h2>
      <ul style={UL}>
        <li>
          <strong>Access and update:</strong> You can view and edit your
          account and customer data inside the Service at any time.
        </li>
        <li>
          <strong>Account deletion:</strong> To permanently delete your
          account and the data associated with it, email{" "}
          <a href="mailto:darryl@flemingusa.com" style={A}>
            darryl@flemingusa.com
          </a>{" "}
          with the subject line &quot;Delete my account.&quot; We will confirm and
          process within 30 days.
        </li>
        <li>
          <strong>Push notifications:</strong> You can disable push
          notifications in your device settings.
        </li>
        <li>
          <strong>Location:</strong> You can revoke location permission in
          your device settings; the dispatch map and en-route features will
          not work without it.
        </li>
        <li>
          <strong>SMS opt-out:</strong> Customers receiving SMS from your
          Service number can reply STOP at any time and we will block further
          messages to that number.
        </li>
        <li>
          <strong>California residents (CCPA / CPRA):</strong> You may
          request to know, delete, or correct the personal information we
          have about you, and to opt out of any &quot;sale&quot; or &quot;sharing&quot; of
          personal information (we do not sell personal information).
          Contact us at the email below.
        </li>
        <li>
          <strong>EU / UK residents (GDPR / UK GDPR):</strong> You have rights
          of access, rectification, erasure, restriction, portability, and
          objection. Contact us at the email below.
        </li>
      </ul>

      <h2 style={H2}>7. Permissions Used by the Mobile App</h2>
      <ul style={UL}>
        <li>
          <strong>Camera and Photo Library</strong> — to attach photos to
          work orders.
        </li>
        <li>
          <strong>Location (when in use)</strong> — to display technician
          location on the dispatcher map and to estimate arrival times.
        </li>
        <li>
          <strong>Notifications</strong> — to alert you about new
          appointments, customer replies, and job status changes.
        </li>
        <li>
          <strong>Near-field communication (NFC)</strong> — when supported,
          to accept contactless payments via Tap to Pay on iPhone (Stripe
          Terminal). Card data is processed by Stripe and never stored by us.
        </li>
      </ul>

      <h2 style={H2}>8. Data Security</h2>
      <p>
        We use industry-standard practices to protect your data, including
        TLS in transit, encryption at rest in Supabase, AES-256-GCM
        encryption for stored third-party API credentials, row-level security
        scoped to each tenant, and least-privilege service accounts. No
        method of transmission or storage is 100% secure.
      </p>

      <h2 style={H2}>9. International Data Transfers</h2>
      <p>
        Our Service is hosted in the United States. If you access the Service
        from outside the U.S., your information will be transferred to and
        processed in the U.S.
      </p>

      <h2 style={H2}>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we
        will revise the &quot;Effective Date&quot; at the top and, for material
        changes, notify you by email or in-app notice.
      </p>

      <h2 style={H2}>11. Contact Us</h2>
      <p>
        Fleming USA
        <br />
        <a href="mailto:darryl@flemingusa.com" style={A}>
          darryl@flemingusa.com
        </a>
        <br />
        <a href="https://fieldbosspro.com" style={A}>
          fieldbosspro.com
        </a>
      </p>

      <p
        style={{
          color: "#94a3b8",
          fontSize: 12,
          marginTop: 48,
          borderTop: "1px solid #e2e8f0",
          paddingTop: 16,
        }}
      >
        Field Boss Pro is a product of Fleming USA.
      </p>
    </div>
  );
}

const H2: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  marginTop: 32,
  marginBottom: 8,
};

const UL: React.CSSProperties = { paddingLeft: 24 };

const A: React.CSSProperties = { color: "#4f46e5" };
