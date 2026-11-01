const shots = [...document.querySelectorAll('.shot')];

if (shots.length && window.HTMLDialogElement) {
  const labels = document.documentElement.lang === 'en'
    ? { viewer: 'Photo viewer', close: 'Close the viewer', prev: 'Previous photo', next: 'Next photo' }
    : { viewer: 'Перегляд фото', close: 'Закрити перегляд', prev: 'Попереднє фото', next: 'Наступне фото' };
  const lightbox = document.createElement('dialog');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('aria-label', labels.viewer);
  lightbox.innerHTML = `
    <p class="lightbox__counter" aria-live="polite"></p>
    <button class="lightbox__button lightbox__button--close" type="button" aria-label="${labels.close}">×</button>
    <figure class="lightbox__figure">
      <img class="lightbox__image" alt="">
    </figure>
    <button class="lightbox__button lightbox__button--prev" type="button" aria-label="${labels.prev}">←</button>
    <button class="lightbox__button lightbox__button--next" type="button" aria-label="${labels.next}">→</button>`;
  document.body.append(lightbox);

  const image = lightbox.querySelector('.lightbox__image');
  const counter = lightbox.querySelector('.lightbox__counter');
  let current = 0;

  const show = (index) => {
    current = (index + shots.length) % shots.length;
    const thumb = shots[current].querySelector('.shot__image');
    lightbox.classList.add('lightbox--loading');
    image.alt = thumb.alt;
    image.sizes = '100vw';
    image.srcset = thumb.srcset;
    image.src = shots[current].href;
    image.style.maxWidth = `${thumb.getAttribute('width') * 2}px`;
    counter.textContent = `${current + 1} / ${shots.length}`;
    const next = new Image();
    next.sizes = '100vw';
    next.srcset = shots[(current + 1) % shots.length].querySelector('.shot__image').srcset;
  };

  image.addEventListener('load', () => lightbox.classList.remove('lightbox--loading'));
  image.addEventListener('error', () => lightbox.classList.remove('lightbox--loading'));

  shots.forEach((link, index) => {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      show(index);
      lightbox.showModal();
      document.documentElement.classList.add('page--locked');
    });
  });

  lightbox.addEventListener('close', () => document.documentElement.classList.remove('page--locked'));

  lightbox.querySelector('.lightbox__button--prev').addEventListener('click', () => show(current - 1));
  lightbox.querySelector('.lightbox__button--next').addEventListener('click', () => show(current + 1));
  lightbox.querySelector('.lightbox__button--close').addEventListener('click', () => lightbox.close());

  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });

  const onPhoto = (event) => {
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    return Math.abs(event.clientX - (box.left + box.width / 2)) <= image.naturalWidth * scale / 2
      && Math.abs(event.clientY - (box.top + box.height / 2)) <= image.naturalHeight * scale / 2;
  };

  let swipeStart = null;
  let swiped = false;
  lightbox.addEventListener('pointerdown', (event) => {
    swipeStart = event.isPrimary ? event.clientX : null;
    swiped = false;
  });
  lightbox.addEventListener('pointerup', (event) => {
    if (swipeStart === null) return;
    const distance = event.clientX - swipeStart;
    swipeStart = null;
    if (Math.abs(distance) > 50) {
      swiped = true;
      show(current + (distance < 0 ? 1 : -1));
    }
  });

  lightbox.addEventListener('click', (event) => {
    if (swiped || event.target.closest('.lightbox__button')) return;
    if (event.target !== image || !onPhoto(event)) lightbox.close();
  });
}

document.querySelectorAll('.video__link').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const frame = document.createElement('iframe');
    frame.className = 'video__frame';
    frame.src = `https://www.youtube-nocookie.com/embed/${link.dataset.video}?autoplay=1`;
    frame.title = link.querySelector('.video__title').textContent;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    link.replaceWith(frame);
    frame.focus();
  });
});
