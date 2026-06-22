const WORKS = {
  'Feature Films': [
    'Chanchal',
    'Pyaar Ishq aur Possession',
    'Game Over',
  ],
  'Web Series': ['Khadaan', 'Tu Zakhm Hai', 'Sshhh Season 2', 'Fuh Se Fantasy'],
}

export default function Works() {
  return (
    <section className="works">
      {Object.entries(WORKS).map(([category, items]) => (
        <div key={category} className="works__group">
          <p className="section-label">{category}</p>

          <div className="works__row">
            {items.map((title) => (
              <article key={title} className="poster-card">
                <div className="poster-card__image" />
                <div className="poster-card__title">{title}</div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
} 