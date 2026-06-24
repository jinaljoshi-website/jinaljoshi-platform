export const C = {
  bg: '#0D0C0A',
  surface: '#161410',
  text: '#F2EBE0',
  muted: '#9B8F83',
  accent: '#C17D4A',
  soft: '#E8C49A',
  rose: '#9C5A5A',
  border: 'rgba(242,235,224,0.08)',
};

export const F = {
  display: "'Cormorant Garamond', Georgia, serif",
  sans: "'DM Sans', system-ui, sans-serif",
  mono: "'DM Mono', 'Courier New', monospace",
};

if (typeof document !== 'undefined' && !document.getElementById('ps-fonts')) {
  const link = document.createElement('link');
  link.id = 'ps-fonts';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@300;400&display=swap';
  document.head.appendChild(link);
}