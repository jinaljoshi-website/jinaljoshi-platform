export default function Contact() {
  return (
    <footer className="contact">
      <div>
        <p className="section-label">Professional inquiries</p>
        <p className="contact__text">
          For casting, representation, press, and collaborations.
        </p>
        <a className="contact__email" href="mailto:team@jinaljoshi.in">
          team@jinaljoshi.in
        </a>
      </div>

      <div className="contact__mark">
        <div>JINAL JOSHI</div>
        <div>{new Date().getFullYear()}</div>
      </div>
    </footer>
  )
}