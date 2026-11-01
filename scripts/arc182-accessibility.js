// Integration adapter only. Original supplied instruments remain byte-identical.
(() => {
  const canvas = document.getElementById('cv_globe');
  if (!canvas) return;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Cartographic Earth globe. Arrow keys rotate; plus and minus zoom. Rotation and projection controls are above the globe.');
  const note = document.createElement('p');
  note.textContent = 'Accessible integration view: focus the globe and use arrow keys to rotate, +/− to zoom, or drag with touch. This is a coarse cartographic model, not a survey instrument. Original source files are preserved separately.';
  canvas.before(note);
  const readout = document.getElementById('globereadout');
  if (readout) { readout.setAttribute('aria-live', 'polite'); readout.setAttribute('role', 'status'); }
  function mouse(type, x, y) {
    canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1 }));
  }
  canvas.addEventListener('keydown', event => {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const moves = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
    if (moves[event.key]) {
      event.preventDefault();
      mouse('mousedown', x, y);
      mouse('mousemove', x + moves[event.key][0], y + moves[event.key][1]);
      mouse('mouseup', x, y);
    } else if (['+', '=', '-', '_'].includes(event.key)) {
      event.preventDefault();
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: ['+', '='].includes(event.key) ? -100 : 100, clientX: x, clientY: y, cancelable: true }));
    }
  });
  canvas.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    event.preventDefault();
    mouse('mousedown', event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', event => {
    if (event.touches.length !== 1) return;
    event.preventDefault();
    mouse('mousemove', event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', () => mouse('mouseup', 0, 0));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const respectMotion = () => {
    const spin = document.getElementById('spinbtn');
    if (motion.matches && spin && spin.textContent.includes('Pause')) spin.click();
  };
  respectMotion();
  motion.addEventListener('change', respectMotion);
})();
