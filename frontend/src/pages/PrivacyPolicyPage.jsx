import { Link } from 'react-router-dom'

const LAST_UPDATED = 'May 15, 2026'
const CONTACT_EMAIL = 'nicholas.lee.lawrence@gmail.com'
const SITE_URL = 'https://compbio-agent-harness.vercel.app'
const DATA_REQUEST_URL = `mailto:${CONTACT_EMAIL}?subject=Data%20Request`

const TOC = [
  { id: 'collect',       label: '1. WHAT INFORMATION DO WE COLLECT?' },
  { id: 'process',       label: '2. HOW DO WE PROCESS YOUR INFORMATION?' },
  { id: 'share',         label: '3. WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL INFORMATION?' },
  { id: 'cookies',       label: '4. DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?' },
  { id: 'ai',            label: '5. DO WE OFFER ARTIFICIAL INTELLIGENCE-BASED PRODUCTS?' },
  { id: 'social',        label: '6. HOW DO WE HANDLE YOUR SOCIAL LOGINS?' },
  { id: 'retention',     label: '7. HOW LONG DO WE KEEP YOUR INFORMATION?' },
  { id: 'safe',          label: '8. HOW DO WE KEEP YOUR INFORMATION SAFE?' },
  { id: 'minors',        label: '9. DO WE COLLECT INFORMATION FROM MINORS?' },
  { id: 'rights',        label: '10. WHAT ARE YOUR PRIVACY RIGHTS?' },
  { id: 'dnt',           label: '11. CONTROLS FOR DO-NOT-TRACK FEATURES' },
  { id: 'us-rights',     label: '12. DO UNITED STATES RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?' },
  { id: 'updates',       label: '13. DO WE MAKE UPDATES TO THIS NOTICE?' },
  { id: 'contact',       label: '14. HOW CAN YOU CONTACT US ABOUT THIS NOTICE?' },
  { id: 'request',       label: '15. HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?' },
]

function SectionTitle({ id, number, title }) {
  return (
    <h2 id={id} className="text-base font-bold text-white uppercase mb-3 pt-2">
      {number}. {title}
    </h2>
  )
}

function InShort({ children }) {
  return (
    <p className="text-sm text-white/50 italic mb-4 leading-relaxed">
      <span className="font-semibold not-italic text-white/60">In Short: </span>
      {children}
    </p>
  )
}

function SubTitle({ children }) {
  return <p className="text-sm font-bold text-white/85 mt-4 mb-1">{children}</p>
}

function Body({ children }) {
  return <p className="text-sm text-white/60 leading-relaxed mb-3">{children}</p>
}

function BulletList({ items }) {
  return (
    <ul className="mb-3 space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-white/60 leading-relaxed">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/25" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function MailLink({ email }) {
  return <a href={`mailto:${email}`} className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors duration-150">{email}</a>
}

function DataRequestLink() {
  return <a href={DATA_REQUEST_URL} className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors duration-150">{CONTACT_EMAIL}</a>
}

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto py-10">

      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2 tracking-tight uppercase">Privacy Policy</h1>
        <p className="text-sm text-white/40 mb-6">Last updated {LAST_UPDATED}</p>

        <Body>
          This Privacy Notice for RNAgent ("we," "us," or "our") describes how and why we might access, collect, store, use, and/or share ("process") your personal information when you use our services ("Services"), including when you:
        </Body>
        <BulletList items={[
          `Visit our website at ${SITE_URL}, or any website of ours that links to this Privacy Notice`,
          'Use RNAgent — an agentic RNA-seq analysis platform for drug-target discovery',
          'Engage with us in other related ways, including any sales, marketing, or events',
        ]} />
        <Body>
          <strong className="text-white/80">Questions or concerns?</strong> Reading this Privacy Notice will help you understand your privacy rights and choices. We are responsible for making decisions about how your personal information is processed. If you do not agree with our policies and practices, please do not use our Services. If you still have any questions or concerns, please contact us at <MailLink email={CONTACT_EMAIL} />.
        </Body>
      </div>

      {/* ── Summary ── */}
      <div className="border border-white/[0.07] rounded-xl p-6 mb-10 space-y-3 bg-white/[0.02]">
        <h2 className="text-base font-bold text-white uppercase mb-4">Summary of Key Points</h2>
        <p className="text-sm text-white/55 italic leading-relaxed mb-4">
          This summary provides key points from our Privacy Notice. You can find more details about any of these topics by clicking the link following each key point or by using our <a href="#toc" className="text-amber-400 hover:text-amber-300 underline underline-offset-2">table of contents</a> below.
        </p>
        {[
          { q: 'What personal information do we process?', a: 'When you visit, use, or navigate our Services, we may process personal information depending on how you interact with us and the Services, the choices you make, and the products and features you use.' },
          { q: 'Do we process any sensitive personal information?', a: 'We do not process sensitive personal information such as racial or ethnic origins, sexual orientation, or religious beliefs.' },
          { q: 'Do we collect any information from third parties?', a: 'We do not collect any information from third parties.' },
          { q: 'How do we process your information?', a: 'We process your information to provide, improve, and administer our Services, for security and fraud prevention, and to comply with law. We process your information only when we have a valid legal reason to do so.' },
          { q: 'In what situations and with which parties do we share personal information?', a: 'We may share information in specific situations with specific third-party AI and data providers required to run analyses you request.' },
          { q: 'How do we keep your information safe?', a: 'We have organisational and technical processes and procedures in place to protect your personal information. However, no electronic transmission over the internet can be guaranteed to be 100% secure.' },
          { q: 'What are your rights?', a: 'Depending on where you are located geographically, the applicable privacy law may mean you have certain rights regarding your personal information.' },
          { q: 'How do you exercise your rights?', a: <>The easiest way to exercise your rights is by emailing us at <DataRequestLink />. We will consider and act upon any request in accordance with applicable data protection laws.</> },
        ].map(({ q, a }) => (
          <p key={q} className="text-sm text-white/60 leading-relaxed">
            <strong className="text-white/80">{q} </strong>{a}
          </p>
        ))}
      </div>

      {/* ── Table of Contents ── */}
      <div id="toc" className="mb-10">
        <h2 className="text-base font-bold text-white uppercase mb-4">Table of Contents</h2>
        <ol className="space-y-1.5">
          {TOC.map(({ id, label }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-sm text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors duration-150">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Sections ── */}
      <div className="space-y-10">

        {/* 1 */}
        <section>
          <SectionTitle id="collect" number="1" title="What Information Do We Collect?" />
          <SubTitle>Personal information you disclose to us</SubTitle>
          <InShort>We collect personal information that you provide to us.</InShort>
          <Body>We collect personal information that you voluntarily provide to us when you register on the Services, express an interest in obtaining information about us or our products and Services, or otherwise when you contact us.</Body>
          <SubTitle>Personal information provided by you</SubTitle>
          <Body>The personal information we collect depends on the context of your interactions with us. The personal information we collect may include:</Body>
          <BulletList items={['Names', 'Email addresses', 'Passwords (stored as bcrypt hashes — plaintext is never stored)']} />
          <SubTitle>Sensitive information</SubTitle>
          <Body>We do not process sensitive information.</Body>
          <SubTitle>Social media login data</SubTitle>
          <Body>We provide you with the option to register with us using your existing Google or GitHub account. If you choose to register in this way, we will collect certain profile information from the social media provider, as described in section 6 below.</Body>
          <SubTitle>Google API</SubTitle>
          <Body>Our use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We access only your email address and public profile to create and authenticate your account. We do not access Google Drive, Gmail, or any other Google resource.</Body>
          <SubTitle>Information automatically collected</SubTitle>
          <InShort>Some information — such as your browser type and session token — is collected automatically when you visit our Services.</InShort>
          <Body>We automatically store a signed JWT session token in your browser's localStorage when you log in. This token expires after 7 days and is used solely to authenticate your requests. We do not collect IP addresses for profiling, browser fingerprints, or behavioural analytics.</Body>
        </section>

        {/* 2 */}
        <section>
          <SectionTitle id="process" number="2" title="How Do We Process Your Information?" />
          <InShort>We process your information to provide, improve, and administer our Services, for security and fraud prevention, and to comply with law.</InShort>
          <Body>We process your personal information for the following reasons:</Body>
          <BulletList items={[
            'To facilitate account creation and authentication and to manage user accounts.',
            'To deliver and facilitate delivery of services to the user — specifically, to run agentic RNA-seq analyses using the parameters you provide.',
            'To save and retrieve your analysis history and sandbox designs.',
            'To respond to user inquiries and solve any potential issues you might have with the Services.',
            'To send administrative information to you, such as details about changes to our terms and policies.',
          ]} />
        </section>

        {/* 3 */}
        <section>
          <SectionTitle id="share" number="3" title="When and With Whom Do We Share Your Personal Information?" />
          <InShort>We may share information in specific situations described in this section and with the following third parties.</InShort>
          <Body>We must share certain data with third-party AI and biological database providers to fulfil the analyses you request. Sharing is limited to the minimum required to complete your query (e.g. a gene symbol or SMILES string). We do not share your name, email address, or account details with any of these providers.</Body>
          <SubTitle>AI and analysis providers</SubTitle>
          <BulletList items={[
            'OpenAI (GPT-4o) — hypothesis text generation and report assembly',
            'Pinecone — dense vector storage for literature retrieval',
            'STRING DB — protein–protein interaction network data',
            'UniProt / AlphaFold EBI — protein structure and functional annotation',
            'OpenTargets — disease–gene association scoring',
            'DepMap Portal — CRISPR essentiality data',
            'ChEMBL — compound binding and clinical drug data',
            'PubMed / NCBI — literature search and abstract retrieval',
          ]} />
          <SubTitle>Business transfers</SubTitle>
          <Body>We may share or transfer your information in connection with, or during negotiations of, any merger, sale of company assets, financing, or acquisition of all or a portion of our business to another company.</Body>
        </section>

        {/* 4 */}
        <section>
          <SectionTitle id="cookies" number="4" title="Do We Use Cookies and Other Tracking Technologies?" />
          <InShort>We do not use cookies or third-party tracking technologies.</InShort>
          <Body>We do not use cookies, web beacons, pixels, or similar tracking technologies. Your session is managed via a JWT stored in your browser's localStorage. We do not use advertising networks, analytics services, or any form of cross-site tracking.</Body>
        </section>

        {/* 5 */}
        <section>
          <SectionTitle id="ai" number="5" title="Do We Offer Artificial Intelligence-Based Products?" />
          <InShort>We offer products, features, and tools powered by artificial intelligence and large language models.</InShort>
          <Body>RNAgent is an AI-powered platform. As part of our Services, we use AI to analyse RNA-seq data, generate mechanistic hypotheses, retrieve relevant scientific literature, and compile preclinical target identification reports.</Body>
          <SubTitle>Use of AI technologies</SubTitle>
          <Body>We provide AI capabilities through OpenAI's GPT-4o API and Pinecone's vector search infrastructure. Your input data — specifically the parameters you provide when running an analysis — will be transmitted to and processed by these services to generate results. We do not transmit your name, email address, or any account credentials to AI providers.</Body>
          <SubTitle>Our AI products</SubTitle>
          <Body>Our AI products are designed for the following functions:</Body>
          <BulletList items={[
            'Differential gene expression analysis using PyDESeq2',
            'Pathway over-representation analysis and GSEA using GSEApy',
            'Protein–protein interaction network construction via STRING DB',
            'Target essentiality validation via DepMap CRISPR scores',
            'Disease–gene association scoring via OpenTargets',
            'Semantic literature retrieval via Pinecone RAG',
            'Drug landscape annotation via ChEMBL',
            'Mechanistic hypothesis synthesis via GPT-4o',
            'Preclinical report generation via GPT-4o',
          ]} />
          <SubTitle>How to opt out</SubTitle>
          <Body>Because AI inference is central to the Services we provide, opting out of AI processing means you will not be able to use the analysis features. You may contact us at <MailLink email={CONTACT_EMAIL} /> to delete your account and all associated data at any time.</Body>
        </section>

        {/* 6 */}
        <section>
          <SectionTitle id="social" number="6" title="How Do We Handle Your Social Logins?" />
          <InShort>If you choose to register or log in using a social media account, we may have access to certain information about you.</InShort>
          <Body>Our Services offer you the ability to register and log in using your Google or GitHub account details. Where you choose to do this, we will receive certain profile information from the provider. The profile information we receive may vary by provider, but will typically include your name and email address.</Body>
          <Body>We will use the information we receive only for the purposes described in this Privacy Notice. We do not access any resources beyond your public profile and primary email address — including but not limited to your Google Drive, Gmail, GitHub repositories, or organisations. We recommend you review the privacy notice of each provider to understand how they collect, use, and share your information.</Body>
        </section>

        {/* 7 */}
        <section>
          <SectionTitle id="retention" number="7" title="How Long Do We Keep Your Information?" />
          <InShort>We keep your information for as long as necessary to fulfil the purposes outlined in this Privacy Notice unless otherwise required by law.</InShort>
          <Body>We will only keep your personal information for as long as it is necessary for the purposes set out in this Privacy Notice, unless a longer retention period is required or permitted by law. No purpose in this notice will require us to keep your personal information for longer than the period in which you have an account with us.</Body>
          <Body>Count matrix files uploaded for analysis are not permanently retained after a job completes or fails. Analysis outputs (results, hypothesis text, reports) are retained for as long as your account exists. Saved sandbox designs are retained until you delete them or close your account.</Body>
          <Body>When you request account deletion, your profile, analysis history, and sandbox designs will be permanently removed from our systems within 30 days.</Body>
        </section>

        {/* 8 */}
        <section>
          <SectionTitle id="safe" number="8" title="How Do We Keep Your Information Safe?" />
          <InShort>We aim to protect your personal information through a system of organisational and technical security measures.</InShort>
          <Body>We have implemented appropriate and reasonable technical and organisational security measures designed to protect the security of any personal information we process. These include:</Body>
          <BulletList items={[
            'Passwords are hashed with bcrypt before storage — plaintext passwords are never stored or logged.',
            'Sessions are authenticated with signed JWTs using a secret key that is never exposed in client-side code.',
            'OAuth exchange codes are single-use, signed JWTs that expire after 90 seconds.',
            'All data in transit is encrypted via HTTPS/TLS.',
            'Sandbox designs are stored per-user and are not accessible by other users.',
          ]} />
          <Body>However, despite our safeguards, no electronic transmission over the internet or information storage technology can be guaranteed to be 100% secure. Although we will do our best to protect your personal information, transmission of personal information to and from our Services is at your own risk.</Body>
        </section>

        {/* 9 */}
        <section>
          <SectionTitle id="minors" number="9" title="Do We Collect Information from Minors?" />
          <InShort>We do not knowingly collect data from or market to children under 18 years of age.</InShort>
          <Body>We do not knowingly collect, solicit data from, or market to children under 18 years of age, nor do we knowingly sell such personal information. By using the Services, you represent that you are at least 18 years of age. If we learn that personal information from users less than 18 years of age has been collected, we will deactivate the account and take reasonable measures to promptly delete such data. If you become aware of any data we may have collected from children under age 18, please contact us at <MailLink email={CONTACT_EMAIL} />.</Body>
        </section>

        {/* 10 */}
        <section>
          <SectionTitle id="rights" number="10" title="What Are Your Privacy Rights?" />
          <InShort>You may review, change, or terminate your account at any time, depending on your country, province, or state of residence.</InShort>
          <SubTitle>Withdrawing your consent</SubTitle>
          <Body>If we are relying on your consent to process your personal information, you have the right to withdraw your consent at any time. You can withdraw your consent by contacting us at <MailLink email={CONTACT_EMAIL} />. This will not affect the lawfulness of processing before its withdrawal.</Body>
          <SubTitle>Account information</SubTitle>
          <Body>If you would at any time like to review, update, or delete the information in your account, you may:</Body>
          <BulletList items={[
            'Log in to your account settings to update your profile information.',
            `Email us at ${CONTACT_EMAIL} to request a copy of, correction of, or deletion of your personal data.`,
          ]} />
          <Body>Upon your request to terminate your account, we will deactivate or delete your account and information from our active databases. However, we may retain some information in our records to prevent fraud, troubleshoot problems, assist with any investigations, enforce our legal terms, and/or comply with applicable legal requirements.</Body>
          <SubTitle>GDPR rights (EEA, UK, Switzerland)</SubTitle>
          <Body>If you are located in the European Economic Area, the United Kingdom, or Switzerland, you have rights under applicable data protection laws including the right to: access your personal data; request rectification or erasure; restrict or object to processing; and data portability. We process your data on the basis of contract performance. To exercise these rights, contact us at <MailLink email={CONTACT_EMAIL} />.</Body>
        </section>

        {/* 11 */}
        <section>
          <SectionTitle id="dnt" number="11" title="Controls for Do-Not-Track Features" />
          <Body>Most web browsers and some mobile operating systems include a Do-Not-Track ("DNT") feature or setting you can activate to signal your privacy preference not to have data about your online browsing activities monitored and collected.</Body>
          <Body>Because we do not use cookies or cross-site tracking technologies of any kind, DNT signals have no practical effect on our Services. We do not track your activity across third-party websites.</Body>
        </section>

        {/* 12 */}
        <section>
          <SectionTitle id="us-rights" number="12" title="Do United States Residents Have Specific Privacy Rights?" />
          <InShort>If you are a resident of California or another US state with a comprehensive privacy law, you may have the right to request access to and receive details about the personal information we maintain about you and how we have processed it, correct inaccuracies, get a copy of, or delete your personal information.</InShort>
          <SubTitle>Categories of personal information we collect</SubTitle>
          <Body>We have collected the following categories of personal information in the past twelve months:</Body>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border border-white/[0.08] bg-white/[0.04]">
                  <th className="text-left text-white/70 font-semibold px-4 py-2.5 border-r border-white/[0.08]">Category</th>
                  <th className="text-left text-white/70 font-semibold px-4 py-2.5 border-r border-white/[0.08]">Examples</th>
                  <th className="text-left text-white/70 font-semibold px-4 py-2.5">Collected</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['A. Identifiers', 'Real name, email address, account name, online identifier', 'YES'],
                  ['B. Personal information (CA Customer Records)', 'Name, contact information, education, employment, financial information', 'NO'],
                  ['C. Protected classification characteristics', 'Gender, age, race, national origin, marital status', 'NO'],
                  ['D. Commercial information', 'Transaction history, purchase history, financial details', 'NO'],
                  ['E. Biometric information', 'Fingerprints and voiceprints', 'NO'],
                  ['F. Internet or network activity', 'Browsing history, search history, online behaviour, interest data', 'NO'],
                  ['G. Geolocation data', 'Device location', 'NO'],
                  ['H. Audio, electronic, or sensory information', 'Images, audio, video, or call recordings', 'NO'],
                  ['I. Professional or employment-related information', 'Job title, work history, professional qualifications', 'NO'],
                  ['J. Education information', 'Student records and directory information', 'NO'],
                  ['K. Inferences from personal information', 'Profile or summary about preferences and characteristics', 'NO'],
                  ['L. Sensitive personal information', '', 'NO'],
                ].map(([cat, ex, col]) => (
                  <tr key={cat} className="border border-white/[0.06]">
                    <td className="px-4 py-3 text-white/60 border-r border-white/[0.06] align-top">{cat}</td>
                    <td className="px-4 py-3 text-white/50 border-r border-white/[0.06] align-top">{ex}</td>
                    <td className={`px-4 py-3 font-semibold align-top ${col === 'YES' ? 'text-amber-400' : 'text-white/30'}`}>{col}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Body>We will use and retain the collected personal information as needed to provide the Services for as long as the user has an account with us.</Body>
          <SubTitle>Your rights</SubTitle>
          <Body>Depending on the state laws that may apply, you may have the right to:</Body>
          <BulletList items={[
            'Know whether we are processing your personal data',
            'Access your personal data',
            'Correct inaccuracies in your personal data',
            'Request deletion of your personal data',
            'Obtain a copy of the personal data you have previously shared with us',
            'Opt out of the sale of your personal data (we do not sell personal data)',
          ]} />
          <SubTitle>How to exercise your rights</SubTitle>
          <Body>To exercise these rights, you may submit a request by emailing <DataRequestLink />. We will respond to all requests within 45 days.</Body>
        </section>

        {/* 13 */}
        <section>
          <SectionTitle id="updates" number="13" title="Do We Make Updates to This Notice?" />
          <InShort>Yes, we will update this notice as necessary to stay compliant with relevant laws.</InShort>
          <Body>We may update this Privacy Notice from time to time. The updated version will be indicated by an updated "Last updated" date at the top of this notice. If we make material changes to this Privacy Notice, we may notify you by prominently posting a notice of such changes. We encourage you to review this Privacy Notice frequently to be informed of how we are protecting your information.</Body>
        </section>

        {/* 14 */}
        <section>
          <SectionTitle id="contact" number="14" title="How Can You Contact Us About This Notice?" />
          <Body>If you have questions or comments about this notice, you may email us at <MailLink email={CONTACT_EMAIL} /> or via the GitHub repository:</Body>
          <Body>
            <a
              href="https://github.com/nicholaslawrence-hub/compbio_agent_harness"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors duration-150"
            >
              github.com/nicholaslawrence-hub/compbio_agent_harness
            </a>
          </Body>
        </section>

        {/* 15 */}
        <section>
          <SectionTitle id="request" number="15" title="How Can You Review, Update, or Delete the Data We Collect from You?" />
          <Body>Based on the applicable laws of your country or state of residence, you may have the right to request access to the personal information we collect from you, details about how we have processed it, correct inaccuracies, or delete your personal information.</Body>
          <Body>
            To request to review, update, or delete your personal information, please submit a request to:{' '}
            <a
              href={DATA_REQUEST_URL}
              className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors duration-150"
            >
              {CONTACT_EMAIL}
            </a>
          </Body>
          <Body>Please include "Data Request" in the subject line and specify whether you are requesting access, correction, or deletion of your data. We will respond within 45 days of receiving your request.</Body>
        </section>

      </div>

      {/* ── Footer nav ── */}
      <div className="border-t border-slate-800 mt-12 pt-6 flex items-center gap-6">
        <Link to="/" className="text-sm text-white/40 hover:text-white transition-colors duration-150">← Back to RNAgent</Link>
        <Link to="/login" className="text-sm text-white/40 hover:text-white transition-colors duration-150">Create Account</Link>
        <a href="https://github.com/nicholaslawrence-hub/compbio_agent_harness" target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white transition-colors duration-150">GitHub</a>
      </div>

    </div>
  )
}
