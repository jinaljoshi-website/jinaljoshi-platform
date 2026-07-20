// backend/scripts/migrate-portfolio.js
// One-time migration: reads the existing hardcoded hero photos and works data,
// uploads every image to R2, and creates the corresponding rows via Studio's own
// API — so nothing needs to be manually re-typed or re-uploaded by hand.
//
// Run locally from the repo root:
//   STUDIO_EMAIL=jinal@... STUDIO_PASSWORD=... node backend/scripts/migrate-portfolio.js

const fs   = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'https://jinaljoshi-platform-production.up.railway.app';
const FRONTEND_PUBLIC = path.join(__dirname, '..', '..', 'frontend', 'public');

const HERO_SLIDES = [
  '/jinal-hero-01.jpg', '/jinal-hero-02.jpg', '/jinal-hero-03.jpg', '/jinal-hero-04.jpg',
  '/jinal-hero-05.jpg', '/jinal-hero-06.jpg', '/jinal-hero-07.jpg', '/jinal-hero-08.jpg',
  '/jinal-hero-09.jpg', '/jinal-hero-10.jpg',
];

// Exact same data currently hardcoded in frontend/src/App.jsx — copied here so this
// script can run independently, with no changes made to the live App.jsx file itself.
const WORKS = {
  films: [
    { title: 'Chanchal', year: '2024', character: 'Chanchal - Lead', watchNow: 'https://www.airtelxstream.in/movies/chanchal-haseena/SHEMAROOME_MOVIE_66c49d93c47b71411800024d?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM088qTc0tjCyuSvdNsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEACUc%2BOhDAAAA', trailer: 'https://www.instagram.com/reel/C_GVTuFS2Xa/', image: '/works/chanchal.jpg' },
    { title: 'Pyaar Ishq aur Possession', year: '2024', character: 'Alisha Khurana - Lead', watchNow: 'https://www.airtelxstream.in/movies/pyaar-ishq-aur-possession/SHEMAROOME_MOVIE_668d5c6dc47b71120d00041f?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM03dPNfYI8fVLtPBOsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEAA1oa4JDAAAA', trailer: 'https://www.youtube.com/watch?v=3eYjRYQuA1E', image: '/works/pyaar-ishq-aur-possession.jpg' },
    { title: 'Game Over', year: '2024', character: 'Dolly Darling - Lead', watchNow: 'https://www.airtelxstream.in/movies/chanchal-haseena/SHEMAROOME_MOVIE_66c49d93c47b71411800024d?_branch_match_id=1527038617621171855&utm_source=AppShare&utm_campaign=MOVIE&_branch_referrer=H4sIAAAAAAAAA8soKSkottLXzy9IzdNLzCwqSc2pKC4pSk3M1cvM088qTc0tjCyuSvdNsq8rSk1LLSrKzEuPTyrKLy9OLbINTkxLLMoEACUc%2BOhDAAAA', trailer: 'https://www.instagram.com/reels/C2P0IMXPSsH/', image: '/works/game-over.jpg' },
  ],
  web_series: [
    { title: 'Sshhh Season 2 - Kalla Kadhal', year: '2025', character: 'Shraddha', watchNow: 'https://www.aha.video/webepisode/43CF9060-E2DE-489D-BC6A-13424047522F', trailer: 'https://www.instagram.com/reel/DO2ukr7gqxS/', image: '/works/sshhh-season-2.jpg' },
    { title: 'Khadaan', year: '2025', character: 'Nupur', watchNow: 'https://www.hungama.com/tv-show/khadaan/124102819/', trailer: 'https://www.hungama.com/movie/_/https:%2F%2Fmedia.hungama.com%2Fc%2F5%2F301%2F384%2F124103311%2F124103311_,200,400,500,750,.mp4%2Findex.m3u8%3Fhdnea%3Dexp%3D3566669168~acl%3D%2F*~hmac%3De8d76f59b95925f97f936bce7fc5fbdf0e65f7368c7cd9489977479ccf564481/tailer/', image: '/works/khadaan.jpg' },
    { title: 'Fuh Se Fantasy', year: '2023', character: 'Neha', watchNow: 'https://www.hotstar.com/in/shows/fuh-se-fantasy/1971002831/house-of-hidden-desires/1971038810/watch?search_query=fuh+se+fantasy', trailer: 'https://www.instagram.com/reel/CydipEOSUV-/', image: '/works/fuh-se-fantasy.jpg' },
    { title: 'Tu Zakhm Hai', year: '2022', character: 'Ananya Trehaan', watchNow: 'https://www.mxplayer.in/show/watch-tu-zakhm-hai/season-1/episode-1-online-546b9ba791a928f24ff2d0305e26fc20', trailer: 'https://www.instagram.com/p/Cj0COiygX2S/', image: '/works/tu-zakhm-hai.jpg' },
  ],
  music_videos: [
    { title: 'OSHO', watchNow: 'https://youtu.be/Am8CgO2XahY', image: '/works/osho.jpg' },
    { title: 'Satrangi Rani', watchNow: 'https://youtu.be/ycjqdfprhtE', image: '/works/satrangi-rani.jpg' },
    { title: 'Aedhi Nijam Naa Praeyesi', watchNow: 'https://youtu.be/TiEumXqArY0', image: '/works/aedhi-nijam-naa-praeyesi.jpg' },
    { title: 'Feels Like', watchNow: 'https://youtu.be/_zDghQMVH1c', image: '/works/feels-like.jpg' },
  ],
  ad_films: [
    { title: 'Airtel', watchNow: 'https://youtu.be/NUAHsQMMiFo', image: '/works/airtel.jpg' },
    { title: 'Netflix (Ray)', watchNow: 'https://youtu.be/U8XkQBZzwh8', image: '/works/netflix-ray.jpg' },
    { title: 'Go Mechanic', watchNow: 'https://www.instagram.com/tv/CXI_d_8BiOd/', image: '/works/go-mechanic.jpg' },
    { title: 'Jaquar', watchNow: 'https://youtube.com/shorts/ZljS_kQpeYc?feature=share', image: '/works/jaquar.jpg' },
    { title: 'Gulbonda', watchNow: 'https://www.instagram.com/reel/Cy2nmhgydxp', image: '/works/gulbonda.jpg' },
    { title: 'Godrej Expert Rich Crème', watchNow: 'https://youtube.com/watch/AzBiiD-rCYY?si=DcSZ3ZnxNDtl2II4', image: '/works/godrej-expert-rich-creme.jpg' },
    { title: 'Zostel', watchNow: 'https://www.instagram.com/reel/DO2vgyLDMiD', image: '/works/zostel.jpg' },
  ],
  short_films: [
    { title: 'Sunday', watchNow: 'https://youtu.be/Jr1FIqjAStE', image: '/works/sunday.jpg' },
    { title: 'Life is Ruff', watchNow: 'https://youtu.be/gjkTOphACXQ', image: '/works/life-is-ruff.jpg' },
    { title: 'Mutually', watchNow: 'https://youtu.be/HGZh20m9Gds', image: '/works/mutually.jpg' },
    { title: 'Shuttered Hearts', watchNow: 'https://youtu.be/ijjQnZQ1pIM', image: '/works/shuttered-hearts.jpg' },
  ],
  skits: [
    { title: 'Second Hand Husband', watchNow: 'https://youtu.be/RluJv2V2BaY', image: '/works/second-hand-husband.jpg' },
    { title: 'Annoying Wife', watchNow: 'https://youtu.be/XFFq4doFtP0', image: '/works/annoying-wife.jpg' },
    { title: 'Stop Trying', watchNow: 'https://youtu.be/k2GLx7HXmUs', image: '/works/stop-trying.jpg' },
    { title: 'Girlfriend ka Siyappa', watchNow: 'https://youtu.be/wo7HuKK-hRQ', image: '/works/girlfriend-ka-siyappa.jpg' },
    { title: 'Annoying Husband', watchNow: 'https://youtu.be/xpSL6WNe7dw', image: '/works/annoying-husband.jpg' },
    { title: 'Dating a Cricket Lover', watchNow: 'https://youtu.be/xxMG-vYz-KM', image: '/works/dating-a-cricket-lover.jpg' },
    { title: 'Shopping Fights', watchNow: 'https://youtu.be/QL7Rv_sUUt4', image: '/works/shopping-fights.jpg' },
    { title: 'Vacation Plans', watchNow: 'https://youtu.be/6ER98yfRYcQ', image: '/works/vacation-plans.jpg' },
    { title: 'Changes after Marriage', watchNow: 'https://youtu.be/DjHxWOpzHZs', image: '/works/changes-after-marriage.jpg' },
    { title: 'Drunk Chronicles', watchNow: 'https://youtu.be/atrX2aY7d4k', image: '/works/drunk-chronicles.jpg' },
    { title: 'Damn You Corona', watchNow: 'https://youtu.be/el0tKqtB2B8', image: '/works/damn-you-corona.jpg' },
    { title: 'The Last Halloween', watchNow: 'https://youtu.be/isiGc0GdtWs', image: '/works/the-last-halloween.jpg' },
    { title: 'Free Fire Diwali', watchNow: 'https://youtu.be/1EZmi5Un_Wo', image: '/works/free-fire-diwali.jpg' },
  ],
};

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function login() {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.STUDIO_EMAIL, password: process.env.STUDIO_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${data.error || res.status}`);
  return data.jwt;
}

async function uploadLocalImage(jwt, localRelativePath) {
  const fullPath = path.join(FRONTEND_PUBLIC, localRelativePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`  ⚠ Skipping missing file: ${localRelativePath}`);
    return null;
  }
  const fileBuffer = fs.readFileSync(fullPath);
  const filename = path.basename(fullPath);
  const contentType = contentTypeFor(fullPath);

  const presignRes = await fetch(`${BACKEND_URL}/api/upload/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ filename, contentType, context: 'portfolio' }),
  });
  const { uploadUrl, publicUrl } = await presignRes.json();
  if (!uploadUrl) throw new Error(`Presign failed for ${filename}`);

  await fetch(uploadUrl, { method: 'PUT', body: fileBuffer, headers: { 'Content-Type': contentType } });
  return publicUrl;
}

async function migrate() {
  if (!process.env.STUDIO_EMAIL || !process.env.STUDIO_PASSWORD) {
    console.error('Set STUDIO_EMAIL and STUDIO_PASSWORD environment variables before running this script.');
    process.exit(1);
  }

  console.log('Logging in...');
  const jwt = await login();

  console.log('\nUploading hero slides...');
  for (const slidePath of HERO_SLIDES) {
    const publicUrl = await uploadLocalImage(jwt, slidePath);
    if (!publicUrl) continue;
    await fetch(`${BACKEND_URL}/api/studio/portfolio/hero-slides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ image_key: publicUrl }),
    });
    console.log(`  ✓ ${slidePath}`);
  }

  console.log('\nUploading works entries...');
  for (const [category, items] of Object.entries(WORKS)) {
    console.log(`  ${category}:`);
    for (const item of items) {
      let imageKey = null;
      if (item.image) imageKey = await uploadLocalImage(jwt, item.image);
      await fetch(`${BACKEND_URL}/api/studio/portfolio/works`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          category, title: item.title, year: item.year || null, character: item.character || null,
          watch_now_url: item.watchNow || null, trailer_url: item.trailer || null, image_key: imageKey,
        }),
      });
      console.log(`    ✓ ${item.title}`);
    }
  }

  console.log('\nDone. Everything is now live in Studio → Website, no manual re-entry needed.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});