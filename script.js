/* =============================================
   OneRule Venture — script.js
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Loading Screen ── */
  const loader = document.getElementById('loading-screen');
  if (loader) {
    setTimeout(() => loader.classList.add('hidden'), 1400);
  }

  /* ── Sticky Navbar ── */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const handleScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  /* ── Mobile Menu ── */
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.querySelector('.mobile-nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      const spans = hamburger.querySelectorAll('span');
      const isOpen = mobileNav.classList.contains('open');
      spans[0].style.transform = isOpen ? 'translateY(7px) rotate(45deg)' : '';
      spans[1].style.opacity   = isOpen ? '0' : '1';
      spans[2].style.transform = isOpen ? 'translateY(-7px) rotate(-45deg)' : '';
    });
    // Close on link click
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.querySelectorAll('span').forEach(s => {
          s.style.transform = ''; s.style.opacity = '';
        });
      });
    });
  }

  /* ── Dark Mode Toggle ── */
  const themeToggle = document.querySelectorAll('.theme-toggle');
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('orv-theme') || 'light';
  root.setAttribute('data-theme', storedTheme);
  updateThemeIcons(storedTheme);

  themeToggle.forEach(btn => {
    btn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('orv-theme', next);
      updateThemeIcons(next);
    });
  });

  function updateThemeIcons(theme) {
    themeToggle.forEach(btn => {
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
      }
    });
  }

  /* ── Scroll Animations ── */
  const animEls = document.querySelectorAll('.animate-on-scroll');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    animEls.forEach(el => io.observe(el));
  } else {
    animEls.forEach(el => el.classList.add('visible'));
  }

  /* ── Active Nav Link ── */
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(a => {
    if (a.getAttribute('href') === currentPage) a.classList.add('active');
  });

  /* ── Counter Animations ── */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const target = parseFloat(el.dataset.count);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals) : 0;
        let start = 0;
        const duration = 1600;
        const step = timestamp => {
          if (!start) start = timestamp;
          const progress = Math.min((timestamp - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = prefix + (eased * target).toFixed(decimals) + suffix;
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        cio.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(c => cio.observe(c));
  }

  /* ── Newsletter Form ── */
  document.querySelectorAll('.newsletter-form, #newsletter-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      if (!input || !input.value.includes('@')) {
        showToast('Please enter a valid email address.', 'warning');
        return;
      }
      showToast('🎉 Subscribed! Welcome to OneRule Venture.', 'success');
      input.value = '';
    });
  });

  /* ── Contact Form ── */
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', e => {
      e.preventDefault();
      const name    = contactForm.querySelector('#name');
      const email   = contactForm.querySelector('#email');
      const message = contactForm.querySelector('#message');
      if (!name.value.trim()) { showToast('Please enter your name.', 'warning'); return; }
      if (!email.value.includes('@')) { showToast('Please enter a valid email.', 'warning'); return; }
      if (!message.value.trim()) { showToast('Please enter a message.', 'warning'); return; }
      showToast('✅ Message sent! We\'ll get back to you soon.', 'success');
      contactForm.reset();
    });
  }

  /* ── Toast Notification ── */
  function showToast(message, type = 'success') {
    const existing = document.querySelector('.orv-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'orv-toast';
    toast.innerHTML = message;
    Object.assign(toast.style, {
      position:     'fixed',
      bottom:       '28px',
      right:        '24px',
      background:   type === 'success' ? 'var(--color-success)' : 'var(--color-warning)',
      color:        '#fff',
      padding:      '14px 22px',
      borderRadius: '12px',
      fontFamily:   'var(--font-body)',
      fontSize:     '.9rem',
      fontWeight:   '500',
      boxShadow:    'var(--shadow-lg)',
      zIndex:       '9999',
      animation:    'fadeInUp .4s both',
      maxWidth:     '360px',
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .4s';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  /* ── Tool: Business Health Score ── */
  const healthBtn = document.getElementById('calc-health');
  if (healthBtn) {
    healthBtn.addEventListener('click', () => {
      const revenue  = parseFloat(document.getElementById('h-revenue')?.value)  || 0;
      const growth   = parseFloat(document.getElementById('h-growth')?.value)   || 0;
      const customers= parseFloat(document.getElementById('h-customers')?.value)|| 0;
      const score = Math.min(100, Math.round(
        (Math.min(revenue / 100000, 40)) +
        (Math.min(growth * 2, 30)) +
        (Math.min(customers / 5, 30))
      ));
      const resultEl = document.getElementById('health-result');
      if (resultEl) {
        const label = score >= 75 ? '🟢 Excellent' : score >= 50 ? '🟡 Good' : '🔴 Needs Attention';
        resultEl.innerHTML = `<div class="result-value">${score}/100</div><div class="result-label">${label}</div>`;
      }
    });
  }

  /* ── Tool: Startup Cost Estimator ── */
  const costBtn = document.getElementById('calc-cost');
  if (costBtn) {
    costBtn.addEventListener('click', () => {
      const team  = parseFloat(document.getElementById('c-team')?.value)  || 0;
      const tech  = parseFloat(document.getElementById('c-tech')?.value)  || 0;
      const mktg  = parseFloat(document.getElementById('c-mktg')?.value)  || 0;
      const total = (team + tech + mktg) * 1.2; // +20% buffer
      const resultEl = document.getElementById('cost-result');
      if (resultEl) {
        resultEl.innerHTML = `<div class="result-value">₹${(total).toLocaleString('en-IN')}</div><div class="result-label">Estimated 6-Month Budget (incl. 20% buffer)</div>`;
      }
    });
  }

  /* ── Tool: Profit Margin Calculator ── */
  const marginBtn = document.getElementById('calc-margin');
  if (marginBtn) {
    marginBtn.addEventListener('click', () => {
      const rev  = parseFloat(document.getElementById('m-revenue')?.value) || 0;
      const cost = parseFloat(document.getElementById('m-cost')?.value)    || 0;
      if (rev === 0) { showToast('Revenue cannot be zero.', 'warning'); return; }
      const margin = ((rev - cost) / rev * 100).toFixed(1);
      const resultEl = document.getElementById('margin-result');
      if (resultEl) {
        const label = margin >= 30 ? '🟢 Healthy margin' : margin >= 10 ? '🟡 Moderate' : '🔴 Low margin';
        resultEl.innerHTML = `<div class="result-value">${margin}%</div><div class="result-label">${label}</div>`;
      }
    });
  }

  /* ── Tool: Market Opportunity Checker ── */
  const mktBtn = document.getElementById('calc-market');
  if (mktBtn) {
    mktBtn.addEventListener('click', () => {
      const size   = parseFloat(document.getElementById('mk-size')?.value)   || 0;
      const growth = parseFloat(document.getElementById('mk-growth')?.value) || 0;
      const comp   = parseFloat(document.getElementById('mk-comp')?.value)   || 5;
      const score  = Math.min(100, Math.round(
        Math.min(size / 1e9 * 30, 30) +
        Math.min(growth * 3, 40) +
        Math.max(30 - comp * 3, 0)
      ));
      const resultEl = document.getElementById('market-result');
      if (resultEl) {
        const label = score >= 70 ? '🚀 High Opportunity' : score >= 40 ? '📊 Moderate' : '⚠️ Competitive';
        resultEl.innerHTML = `<div class="result-value">${score}/100</div><div class="result-label">${label}</div>`;
      }
    });
  }

  /* ── Dashboard Revenue Chart ── */
  const revenueCtx = document.getElementById('revenueChart');
  if (revenueCtx && typeof Chart !== 'undefined') {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';
    new Chart(revenueCtx, {
      type: 'line',
      data: {
        labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets: [
          {
            label: 'Revenue (₹L)',
            data: [12, 19, 15, 28, 24, 32, 38, 35, 42, 48, 44, 56],
            borderColor: '#1a56db',
            backgroundColor: 'rgba(26,86,219,.08)',
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#1a56db',
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Target (₹L)',
            data: [15, 18, 22, 25, 30, 30, 35, 38, 40, 45, 50, 55],
            borderColor: '#0ea5e9',
            borderDash: [6, 3],
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { font: { family: 'DM Sans', size: 11 } } },
          y: { grid: { color: gridColor }, ticks: { font: { family: 'DM Sans', size: 11 } } }
        },
        interaction: { intersect: false, mode: 'nearest' }
      }
    });
  }

  /* ── Dashboard Sector Chart ── */
  const sectorCtx = document.getElementById('sectorChart');
  if (sectorCtx && typeof Chart !== 'undefined') {
    new Chart(sectorCtx, {
      type: 'doughnut',
      data: {
        labels: ['Tech', 'Retail', 'Services', 'Mfg', 'Other'],
        datasets: [{
          data: [38, 22, 18, 12, 10],
          backgroundColor: ['#1a56db','#0ea5e9','#10b981','#f59e0b','#8b5cf6'],
          borderWidth: 0,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 16, usePointStyle: true } }
        }
      }
    });
  }

  /* ── Pricing Toggle ── */
  const pricingToggle = document.getElementById('pricing-toggle');
  if (pricingToggle) {
    const prices = {
      starter:    { monthly: '₹999',  annual: '₹799'  },
      growth:     { monthly: '₹2,999',annual: '₹2,399'},
      enterprise: { monthly: '₹7,999',annual: '₹6,399'},
    };
    pricingToggle.addEventListener('change', function() {
      const mode = this.checked ? 'annual' : 'monthly';
      Object.keys(prices).forEach(plan => {
        const el = document.querySelector(`[data-plan="${plan}"] .price-amount`);
        if (el) el.textContent = prices[plan][mode];
      });
    });
  }

  /* ── Smooth scroll for in-page links ── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

});
