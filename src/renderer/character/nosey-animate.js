import gsap from 'gsap'

let currentTween = null
let blinkTween = null
let thoughtTween = null

function stopAll() {
  if (currentTween) {
    currentTween.kill()
    currentTween = null
  }
  if (blinkTween) {
    blinkTween.kill()
    blinkTween = null
  }
  if (thoughtTween) {
    thoughtTween.kill()
    thoughtTween = null
  }
}

function startBlink() {
  blinkTween = gsap
    .timeline({ repeat: -1, repeatDelay: 3, delay: 2 })
    .to(['#left-eyelid', '#right-eyelid'], {
      scaleY: 1,
      transformOrigin: 'center top',
      duration: 0.08,
      ease: 'power2.in',
    })
    .to(['#left-eyelid', '#right-eyelid'], {
      scaleY: 0,
      transformOrigin: 'center top',
      duration: 0.1,
      ease: 'power2.out',
    })
}

// Pupil and eye-glint move together everywhere -- the glint is a separate
// element and does not follow the pupil unless targeted alongside it.
const EYES = ['#left-pupil', '#right-pupil', '#left-eye-glint', '#right-eye-glint']
const BROWS = ['#left-eyebrow', '#right-eyebrow']

function startThoughtDots() {
  thoughtTween = gsap
    .timeline({ repeat: -1, repeatDelay: 0.4 })
    .to('#thought-dot-1', { y: -2, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut' })
    .to(
      '#thought-dot-2',
      { y: -2, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut' },
      '-=0.14'
    )
    .to(
      '#thought-dot-3',
      { y: -2, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut' },
      '-=0.14'
    )
}

const states = {
  idle() {
    gsap.set(['#left-eyelid', '#right-eyelid'], { scaleY: 0, transformOrigin: 'center top' })
    gsap.to('#nosey-arm-right', { rotation: 0, svgOrigin: '76 70', duration: 0.35 })
    gsap.to('#nosey-magnifier', { scale: 1, svgOrigin: '68 89', duration: 0.2 })
    gsap.to('#nosey-mouth', { scaleY: 1, transformOrigin: 'center top', duration: 0.15 })
    gsap.to(BROWS, { y: 0, duration: 0.2 })
    gsap.to(EYES, { x: 0, y: 0, duration: 0.2 })
    gsap.to('#nosey-thought-bubble', { opacity: 0, duration: 0.2 })
    currentTween = gsap.to('#nosey-character', {
      y: -6,
      duration: 1.8,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    })
    startBlink()
  },

  thinking() {
    gsap.set(['#left-eyelid', '#right-eyelid'], { scaleY: 0, transformOrigin: 'center top' })
    // Raise the magnifier once as a "thinking pose" -- this stays outside the
    // repeating loop below so the eyes keep darting without replaying it.
    gsap.to('#nosey-arm-right', {
      rotation: -25,
      svgOrigin: '76 70',
      duration: 0.6,
      ease: 'power2.inOut',
    })
    gsap.to('#nosey-magnifier', { scale: 1.08, svgOrigin: '68 89', duration: 0.4 })
    gsap.to('#nosey-thought-bubble', { opacity: 1, duration: 0.25 })
    startThoughtDots()

    currentTween = gsap
      .timeline({ repeat: -1 })
      .to(BROWS, { y: -1.2, duration: 0.4 })
      .to(EYES, { x: -3, y: -2.5, duration: 0.5, ease: 'power2.inOut' }, '<')
      .to(EYES, { x: 3, y: -2.5, duration: 0.9, ease: 'sine.inOut' })
      .to(BROWS, { y: 0, duration: 0.3 })
      .to(EYES, { x: 0, y: 0, duration: 0.5, ease: 'sine.inOut' }, '<')
  },

  talking() {
    gsap.set(['#left-eyelid', '#right-eyelid'], { scaleY: 0, transformOrigin: 'center top' })
    gsap.to('#nosey-arm-right', { rotation: 0, svgOrigin: '76 70', duration: 0.25 })
    gsap.to('#nosey-magnifier', { scale: 1, svgOrigin: '68 89', duration: 0.2 })
    gsap.to(BROWS, { y: 0, duration: 0.2 })
    gsap.to(EYES, { x: 0, y: 0, duration: 0.2 })
    gsap.to('#nosey-thought-bubble', { opacity: 0, duration: 0.2 })
    currentTween = gsap.to('#nosey-mouth', {
      scaleY: 3,
      transformOrigin: 'center top',
      duration: 0.12,
      ease: 'power1.inOut',
      yoyo: true,
      repeat: -1,
    })
  },

  peeking() {
    currentTween = gsap
      .timeline()
      .fromTo('#nosey-character', { x: 200 }, { x: 0, duration: 0.45, ease: 'back.out(1.4)' })
      .to(EYES, { x: -8, duration: 0.4, ease: 'power2.out' })
      .to(EYES, { x: 6, duration: 0.6, ease: 'power2.inOut' })
      .to(EYES, { x: 0, duration: 0.3 })
      .call(() => setState('idle'))
  },
}

export function setState(name) {
  stopAll()
  if (states[name]) states[name]()
}

if (typeof window !== 'undefined') {
  window.noseyAnimate = { setState }
}

gsap.set(['#left-eyelid', '#right-eyelid'], { scaleY: 0, transformOrigin: 'center top' })
setState('idle')
