try {
  var storedTheme = localStorage.getItem('wingmacc_theme');
  if (storedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0B0F17');
  } else if (storedTheme === 'light') {
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'light');
  }
} catch (e) {}
