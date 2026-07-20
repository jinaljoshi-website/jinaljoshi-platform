import { useEffect, useRef, useState } from 'react'

// Fallback content — used only if the live portfolio API is unreachable, so the site
// never breaks even during a backend outage.
const FALLBACK_SLIDES = [
  '/jinal-hero-01.jpg',
  '/jinal-hero-02.jpg',
  '/jinal-hero-03.jpg',
  '/jinal-hero-04.jpg',
  '/jinal-hero-05.jpg',
  '/jinal-hero-06.jpg',
  '/jinal-hero-07.jpg',
  '/jinal-hero-08.jpg',
  '/jinal-hero-09.jpg',
  '/jinal-hero-10.jpg',
]

const HERO_INTERVAL = 6000
const CAROUSEL_INTERVAL = 6000

function getYouTubeId(url) {
  if (!url) return null

  try {
    const parsed = new URL(url)

    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '') || null
    }

    if (parsed.pathname.includes('/watch')) {
      return parsed.searchParams.get('v')
    }

    if (parsed.pathname.includes('/shorts/')) {
      return parsed.pathname.split('/shorts/')[1]?.split('/')[0] || null
    }

    if (parsed.pathname.includes('/embed/')) {
      return parsed.pathname.split('/embed/')[1]?.split('/')[0] || null
    }

    return null
  } catch {
    return null
  }
}

function getEmbedInfo(url) {
  const youtubeId = getYouTubeId(url)

  if (youtubeId) {
    return {
      type: 'youtube',
      videoId: youtubeId,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&playsinline=1`,
    }
  }

  if (url?.includes('instagram.com')) {
    return {
      type: 'instagram',
      videoId: null,
      embedUrl: null,
    }
  }

  return {
    type: 'external',
    videoId: null,
    embedUrl: null,
  }
}

const FALLBACK_WORKS = {
  films: [
    {
      title: 'Chanchal',
      year: '2024',
      character: 'Chanchal - Lead',
      watchNow:
        'https://www.airtelxstream.in/movies/chanchal-haseena/SHEMAROOME_MOVIE_66c49d93c47b71411800024d?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM088qTc0tjCyuSvdNsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEACUc%2BOhDAAAA',
      trailer: 'https://www.instagram.com/reel/C_GVTuFS2Xa/',
      image: '/works/chanchal.jpg',
    },
    {
      title: 'Pyaar Ishq aur Possession',
      year: '2024',
      character: 'Alisha Khurana - Lead',
      watchNow:
        'https://www.airtelxstream.in/movies/pyaar-ishq-aur-possession/SHEMAROOME_MOVIE_668d5c6dc47b71120d00041f?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM03dPNfYI8fVLtPBOsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEAA1oa4JDAAAA',
      trailer: 'https://www.youtube.com/watch?v=3eYjRYQuA1E',
      image: '/works/pyaar-ishq-aur-possession.jpg',
    },
    {
      title: 'Game Over',
      year: '2024',
      character: 'Dolly Darling - Lead',
      watchNow:
        'https://www.airtelxstream.in/movies/chanchal-haseena/SHEMAROOME_MOVIE_66c49d93c47b71411800024d?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM088qTc0tjCyuSvdNsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEACUc%2BOhDAAAA',
      trailer: 'https://www.instagram.com/reels/C2P0IMXPSsH/',
      image: '/works/game-over.jpg',
    },
  ],
  webSeries: [
    {
      title: 'Sshhh Season 2 - Kalla Kadhal',
      year: '2025',
      character: 'Shraddha',
      watchNow:
        'https://www.aha.video/webepisode/43CF9060-E2DE-489D-BC6A-13424047522F',
      trailer: 'https://www.instagram.com/reel/DO2ukr7gqxS/',
      image: '/works/sshhh-season-2.jpg',
    },
    {
      title: 'Khadaan',
      year: '2025',
      character: 'Nupur',
      watchNow: 'https://www.hungama.com/tv-show/khadaan/124102819/',
      trailer:
        'https://www.hungama.com/movie/_/https:%2F%2Fmedia.hungama.com%2Fc%2F5%2F301%2F384%2F124103311%2F124103311_,200,400,500,750,.mp4%2Findex.m3u8%3Fhdnea%3Dexp%3D3566669168~acl%3D%2F*~hmac%3De8d76f59b95925f97f936bce7fc5fbdf0e65f7368c7cd9489977479ccf564481/tailer/',
      image: '/works/khadaan.jpg',
    },
    {
      title: 'Fuh Se Fantasy',
      year: '2023',
      character: 'Neha',
      watchNow:
        'https://www.hotstar.com/in/shows/fuh-se-fantasy/1971002831/house-of-hidden-desires/1971038810/watch?search_query=fuh+se+fantasy',
      trailer: 'https://www.instagram.com/reel/CydipEOSUV-/',
      image: '/works/fuh-se-fantasy.jpg',
    },
    {
      title: 'Tu Zakhm Hai',
      year: '2022',
      character: 'Ananya Trehaan',
      watchNow:
        'https://www.mxplayer.in/show/watch-tu-zakhm-hai/season-1/episode-1-online-546b9ba791a928f24ff2d0305e26fc20',
      trailer: 'https://www.instagram.com/p/Cj0COiygX2S/',
      image: '/works/tu-zakhm-hai.jpg',
    },
  ],
  musicVideos: [
    {
      title: 'OSHO',
      watchNow: 'https://youtu.be/Am8CgO2XahY',
      image: '/works/osho.jpg',
    },
    {
      title: 'Satrangi Rani',
      watchNow: 'https://youtu.be/ycjqdfprhtE',
      image: '/works/satrangi-rani.jpg',
    },
    {
      title: 'Aedhi Nijam Naa Praeyesi',
      watchNow: 'https://youtu.be/TiEumXqArY0',
      image: '/works/aedhi-nijam-naa-praeyesi.jpg',
    },
    {
      title: 'Feels Like',
      watchNow: 'https://youtu.be/_zDghQMVH1c',
      image: '/works/feels-like.jpg',
    },
  ],
  adFilms: [
    {
      title: 'Airtel',
      watchNow: 'https://youtu.be/NUAHsQMMiFo',
      image: '/works/airtel.jpg',
    },
    {
      title: 'Netflix (Ray)',
      watchNow: 'https://youtu.be/U8XkQBZzwh8',
      image: '/works/netflix-ray.jpg',
    },
    {
      title: 'Go Mechanic',
      watchNow: 'https://www.instagram.com/tv/CXI_d_8BiOd/',
      image: '/works/go-mechanic.jpg',
    },
    {
      title: 'Jaquar',
      watchNow: 'https://youtube.com/shorts/ZljS_kQpeYc?feature=share',
      image: '/works/jaquar.jpg',
    },
    {
      title: 'Gulbonda',
      watchNow: 'https://www.instagram.com/reel/Cy2nmhgydxp',
      image: '/works/gulbonda.jpg',
    },
    {
      title: 'Godrej Expert Rich Crème',
      watchNow: 'https://youtube.com/watch/AzBiiD-rCYY?si=DcSZ3ZnxNDtl2II4',
      image: '/works/godrej-expert-rich-creme.jpg',
    },
    {
      title: 'Zostel',
      watchNow: 'https://www.instagram.com/reel/DO2vgyLDMiD',
      image: '/works/zostel.jpg',
    },
  ],
  shortFilms: [
    {
      title: 'Sunday',
      watchNow: 'https://youtu.be/Jr1FIqjAStE',
      image: '/works/sunday.jpg',
    },
    {
      title: 'Life is Ruff',
      watchNow: 'https://youtu.be/gjkTOphACXQ',
      image: '/works/life-is-ruff.jpg',
    },
    {
      title: 'Mutually',
      watchNow: 'https://youtu.be/HGZh20m9Gds',
      image: '/works/mutually.jpg',
    },
    {
      title: 'Shuttered Hearts',
      watchNow: 'https://youtu.be/ijjQnZQ1pIM',
      image: '/works/shuttered-hearts.jpg',
    },
  ],
  skits: [
    {
      title: 'Second Hand Husband',
      watchNow: 'https://youtu.be/RluJv2V2BaY',
      image: '/works/second-hand-husband.jpg',
    },
    {
      title: 'Annoying Wife',
      watchNow: 'https://youtu.be/XFFq4doFtP0',
      image: '/works/annoying-wife.jpg',
    },
    {
      title: 'Stop Trying',
      watchNow: 'https://youtu.be/k2GLx7HXmUs',
      image: '/works/stop-trying.jpg',
    },
    {
      title: 'Girlfriend ka Siyappa',
      watchNow: 'https://youtu.be/wo7HuKK-hRQ',
      image: '/works/girlfriend-ka-siyappa.jpg',
    },
    {
      title: 'Annoying Husband',
      watchNow: 'https://youtu.be/xpSL6WNe7dw',
      image: '/works/annoying-husband.jpg',
    },
    {
      title: 'Dating a Cricket Lover',
      watchNow: 'https://youtu.be/xxMG-vYz-KM',
      image: '/works/dating-a-cricket-lover.jpg',
    },
    {
      title: 'Shopping Fights',
      watchNow: 'https://youtu.be/QL7Rv_sUUt4',
      image: '/works/shopping-fights.jpg',
    },
    {
      title: 'Vacation Plans',
      watchNow: 'https://youtu.be/6ER98yfRYcQ',
      image: '/works/vacation-plans.jpg',
    },
    {
      title: 'Changes after Marriage',
      watchNow: 'https://youtu.be/DjHxWOpzHZs',
      image: '/works/changes-after-marriage.jpg',
    },
    {
      title: 'Drunk Chronicles',
      watchNow: 'https://youtu.be/atrX2aY7d4k',
      image: '/works/drunk-chronicles.jpg',
    },
    {
      title: 'Damn You Corona',
      watchNow: 'https://youtu.be/el0tKqtB2B8',
      image: '/works/damn-you-corona.jpg',
    },
    {
      title: 'The Last Halloween',
      watchNow: 'https://youtu.be/isiGc0GdtWs',
      image: '/works/the-last-halloween.jpg',
    },
    {
      title: 'Free Fire Diwali',
      watchNow: 'https://youtu.be/1EZmi5Un_Wo',
      image: '/works/free-fire-diwali.jpg',
    },
  ],
}

function WorkMeta({ label, value }) {
  return (
    <div className="work-meta">
      <div className="work-meta__label">{label}</div>
      <div className="work-meta__value">{value || '—'}</div>
    </div>
  )
}

function CarouselControls({ current, total, onPrev, onNext, isPaused, onTogglePause, compact = false }) {
  return (
    <div className={`carousel-controls ${compact ? 'carousel-controls--compact' : ''}`}>
      <button
        type="button"
        className="carousel-arrow"
        onClick={onPrev}
        aria-label="Previous item"
      >
        ←
      </button>

      <div className="carousel-count">
        {current + 1} of {total}
      </div>

      <button
        type="button"
        className="carousel-arrow"
        onClick={onNext}
        aria-label="Next item"
      >
        →
      </button>

      <button
        type="button"
        className="carousel-pause"
        onClick={onTogglePause}
        aria-label={isPaused ? 'Resume autoplay' : 'Pause autoplay'}
        title={isPaused ? 'Resume' : 'Pause'}
      >
        {isPaused ? '▶' : '❙❙'}
      </button>
    </div>
  )
}

function useConstantCarousel(itemsLength, interval = CAROUSEL_INTERVAL) {
  const [index, setIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const [isManuallyPaused, setIsManuallyPaused] = useState(false)
  const intervalRef = useRef(null)
  const pausedRef = useRef(false)

  const isPaused = isHovering || isManuallyPaused

  useEffect(() => {
    pausedRef.current = isPaused
  }, [isPaused])

  const clearTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  const startTimer = () => {
    clearTimer()
    if (itemsLength <= 1) return
    intervalRef.current = setInterval(() => {
      if (!pausedRef.current) {
        setIndex((prev) => (prev + 1) % itemsLength)
      }
    }, interval)
  }

  useEffect(() => {
    setIndex(0)
    startTimer()
    return clearTimer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsLength, interval])

  const goTo = (nextIndex) => {
    setIndex((nextIndex + itemsLength) % itemsLength)
  }

  const next = () => goTo(index + 1)
  const prev = () => goTo(index - 1)
  const togglePause = () => setIsManuallyPaused((p) => !p)

  return {
    index,
    goTo,
    next,
    prev,
    isPaused,
    togglePause,
    hoverHandlers: {
      onMouseEnter: () => setIsHovering(true),
      onMouseLeave: () => setIsHovering(false),
    },
  }
}

function WorksCarouselSection({ title, items }) {
  const { index, next, prev, isPaused, togglePause, hoverHandlers } = useConstantCarousel(items.length)
  const activeItem = items[index]

  return (
    <section className="works-section" {...hoverHandlers}>
      <div className="works-section__header">
        <h2 className="works-section__title">{title}</h2>
        <CarouselControls
          current={index}
          total={items.length}
          onPrev={prev}
          onNext={next}
          isPaused={isPaused}
          onTogglePause={togglePause}
        />
      </div>

      <div className="works-feature works-feature--locked">
        <div className="works-feature__media works-feature__media--locked works-feature__media--visible">
          <img
            src={activeItem.image}
            alt={activeItem.title}
            className="works-feature__image works-feature__image--contain"
            draggable="false"
          />
        </div>

        <div className="works-feature__content works-feature__content--visible">
          <div className="works-feature__meta-grid works-feature__meta-grid--works">
            <WorkMeta label="Title" value={activeItem.title} />
            <WorkMeta label="Year of Release" value={activeItem.year} />
            <WorkMeta label="Character" value={activeItem.character} />
          </div>

          <div className="works-feature__links works-feature__links--below-meta">
            {activeItem.watchNow && (
              <a
                href={activeItem.watchNow}
                target="_blank"
                rel="noopener noreferrer"
                className="works-feature__button"
              >
                Watch Now
              </a>
            )}

            {activeItem.trailer && (
              <a
                href={activeItem.trailer}
                target="_blank"
                rel="noopener noreferrer"
                className="works-feature__button works-feature__button--ghost"
              >
                Trailer
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function AutoVideoPanel({ title, items }) {
  const { index, next, prev, isPaused, togglePause, hoverHandlers } = useConstantCarousel(items.length)
  const activeItem = items[index]
  const embed = getEmbedInfo(activeItem.watchNow)

  return (
    <div className="split-video__panel" {...hoverHandlers}>
      <div className="split-video__panel-header">
        <h2 className="split-video__title">{title}</h2>
        <CarouselControls
          current={index}
          total={items.length}
          onPrev={prev}
          onNext={next}
          isPaused={isPaused}
          onTogglePause={togglePause}
          compact
        />
      </div>

      <div className="split-video__stage split-video__stage--visible">
        {embed.type === 'youtube' && embed.embedUrl ? (
          <div className="split-video__iframe-wrap">
            <iframe
              className="split-video__iframe"
              src={embed.embedUrl}
              title={`${title} - ${activeItem.title}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <a
            href={activeItem.watchNow}
            target="_blank"
            rel="noopener noreferrer"
            className="split-video__fallback"
          >
            <img
              src={activeItem.image}
              alt={activeItem.title}
              className="split-video__fallback-image"
              draggable="false"
            />
            <div className="split-video__fallback-note">
              Opens on {embed.type === 'instagram' ? 'Instagram' : 'external site'}
            </div>
          </a>
        )}
      </div>

      <div className="split-video__body split-video__body--compact">
        <a
          href={activeItem.watchNow}
          target="_blank"
          rel="noopener noreferrer"
          className="split-video__linked-title"
        >
          {activeItem.title}
        </a>
        <div className="split-video__more">More</div>
      </div>
    </div>
  )
}

function SplitVideoSection({ leftTitle, leftItems, rightTitle, rightItems }) {
  return (
    <section className="split-video">
      <AutoVideoPanel title={leftTitle} items={leftItems} />
      <AutoVideoPanel title={rightTitle} items={rightItems} />
    </section>
  )
}

function ContactSection() {
  return (
    <section className="contact-cta">
      <div className="contact-cta__inner">
        <p className="contact-cta__eyebrow">Contact</p>

        <h2 className="contact-cta__title">
          Let's work together
        </h2>

        <p className="contact-cta__note">
          For casting enquiries, collaborations, and professional conversations,
          please reach out directly.
        </p>

        <div className="contact-cta__grid">
          <div className="contact-cta__item">
            <span className="contact-cta__label">Email</span>
            <span className="contact-cta__value">hello@jinaljj.com</span>
            <a
              href="mailto:hello@jinaljj.com"
              className="works-feature__button contact-cta__action"
            >
              Send Email
            </a>
          </div>

          <div className="contact-cta__item">
            <span className="contact-cta__label">WhatsApp (Team Managed)</span>
            <span className="contact-cta__value">+91 86898 88658</span>
            <a
              href="https://wa.me/918689888658"
              target="_blank"
              rel="noopener noreferrer"
              className="works-feature__button contact-cta__action"
            >
              Send Message
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

const API_BASE = import.meta.env.VITE_API_URL

export default function App() {
  const [slides, setSlides] = useState(FALLBACK_SLIDES)
  const [worksData, setWorksData] = useState(FALLBACK_WORKS)
  const [current, setCurrent] = useState(0)
  const [heroPaused, setHeroPaused] = useState(false)
  const [heroHovering, setHeroHovering] = useState(false)
  const heroTimerRef = useRef(null)
  const heroPausedRef = useRef(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/portfolio`)
      .then((r) => r.json())
      .then((data) => {
        if (data.heroSlides?.length) setSlides(data.heroSlides)
        if (data.works) {
          setWorksData({
            films: data.works.films?.length ? data.works.films : FALLBACK_WORKS.films,
            webSeries: data.works.web_series?.length ? data.works.web_series : FALLBACK_WORKS.webSeries,
            musicVideos: data.works.music_videos?.length ? data.works.music_videos : FALLBACK_WORKS.musicVideos,
            adFilms: data.works.ad_films?.length ? data.works.ad_films : FALLBACK_WORKS.adFilms,
            shortFilms: data.works.short_films?.length ? data.works.short_films : FALLBACK_WORKS.shortFilms,
            skits: data.works.skits?.length ? data.works.skits : FALLBACK_WORKS.skits,
          })
        }
      })
      .catch(() => {}) // silently keep fallback content on any failure
  }, [])

  useEffect(() => {
    heroPausedRef.current = heroPaused || heroHovering
  }, [heroPaused, heroHovering])

  const restartHeroTimer = () => {
    if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    if (slides.length <= 1) return

    heroTimerRef.current = setInterval(() => {
      if (!heroPausedRef.current) {
        setCurrent((prev) => (prev + 1) % slides.length)
      }
    }, HERO_INTERVAL)
  }

  useEffect(() => {
    document.title = 'Jinal Joshi'
    restartHeroTimer()

    return () => {
      if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides])

  const goToHero = (index) => {
    setCurrent(index)
  }

  const nextHero = () => {
    setCurrent((prev) => (prev + 1) % slides.length)
  }

  return (
    <div className="site-shell">
      <main>
        <section
          className="hero"
          onMouseEnter={() => setHeroHovering(true)}
          onMouseLeave={() => setHeroHovering(false)}
        >
          <div
            className="hero__tap-target"
            onClick={nextHero}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                nextHero()
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Show next photo"
          >
            {slides.map((src, index) => (
              <img
                key={src}
                className={`hero__image ${index === current ? 'is-active' : ''}`}
                src={src}
                alt="Jinal Joshi"
                draggable="false"
              />
            ))}

            <div className="hero__scrim" />

            <div className="hero__caption">
              <h1 className="hero__name">Jinal Joshi</h1>
              <p className="hero__meta">Actor — Mumbai</p>
            </div>
          </div>

          {slides.length > 1 && (
            <div className="hero__nav">
              <div className="hero__count">
                {current + 1} of {slides.length}
              </div>

              <div className="hero__dots">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`hero__dot ${index === current ? 'is-active' : ''}`}
                    onClick={() => goToHero(index)}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>

              <button
                type="button"
                className="hero__pause"
                onClick={(e) => { e.stopPropagation(); setHeroPaused((p) => !p) }}
                aria-label={heroPaused ? 'Resume slideshow' : 'Pause slideshow'}
                title={heroPaused ? 'Resume' : 'Pause'}
              >
                {heroPaused ? '▶' : '❙❙'}
              </button>
            </div>
          )}
        </section>

        <section className="about">
          <div className="about__eyebrow">About</div>

          <div className="about__grid">
            <div className="about__copy">
              <p className="about__quote">
                Storytelling is the only thing I have ever been serious about.
              </p>

              <p className="about__text">
                Jinal Joshi is an actor based in Mumbai whose work spans feature
                films, web series, short films, music videos, ad films, and
                short-form videos. A body of work shaped by presence, precision,
                and a deep interest in the emotional life of a character.
              </p>

              <p className="about__text">
                This homepage is a focused, professional view of Jinal Joshi's work and
                screen presence composed for collaborators, casting teams,
                filmmakers, and brands.
              </p>
            </div>

            <div className="about__stats">
              <div>3 Feature Films</div>
              <div>4 Web Series</div>
              <div>4 Music Videos</div>
              <div>3 Short Films</div>
              <div>6 Ad Films</div>
              <div>2 Releases in 2025</div>
            </div>
          </div>

          <div className="about__links">
            <a
              href="https://www.imdb.com/name/nm11605923/"
              target="_blank"
              rel="noopener noreferrer"
            >
              IMDb
            </a>
            <a
              href="https://www.instagram.com/jinal.j.j/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
            <a
              href="https://www.youtube.com/@JinalJJ"
              target="_blank"
              rel="noopener noreferrer"
            >
              YouTube
            </a>
            <a
              href="https://www.facebook.com/jinal.jjj"
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook
            </a>
          </div>
        </section>

        <section className="works">
          <WorksCarouselSection title="Films" items={worksData.films} />
          <WorksCarouselSection title="Web Series" items={worksData.webSeries} />

          <SplitVideoSection
            leftTitle="Music Videos"
            leftItems={worksData.musicVideos}
            rightTitle="Ad Films"
            rightItems={worksData.adFilms}
          />

          <SplitVideoSection
            leftTitle="Short Films"
            leftItems={worksData.shortFilms}
            rightTitle="Skits / Short Videos"
            rightItems={worksData.skits}
          />

          <ContactSection />
        </section>
      </main>
    </div>
  )
}