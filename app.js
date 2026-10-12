const $ = (selector) => document.querySelector(selector);
const rewardScreen = $('#reward-screen');
const revealScreen = $('#reveal-screen');
const closedScreen = $('#closed-screen');
const claimButton = $('#claim');
const tooltip = $('#reward-tooltip');
const settings = $('#prototype-settings');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const storageKey = 'kvizi-flow-v1';
const initialState = () => ({ day: 1, claimed: false, energy: 16, coins: 0, returning: false, loss: false, restarted: false, restored: false });
let state = initialState();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Number.isSafeInteger(saved.day) && saved.day >= 1 && saved.day <= Number.MAX_SAFE_INTEGER - 5 &&
      typeof saved.claimed === 'boolean' && Number.isFinite(saved.energy) && saved.energy >= 0 &&
      Number.isFinite(saved.coins) && saved.coins >= 0) state = { ...state, ...saved };
} catch { /* The prototype also works when browser storage is unavailable. */ }
let screen = 'daily';
let pending = null;
let flightRunning = false;
let transitionTimer = null;
let animationRun = 0;
let idleAnimation = null;
let botJump = null;
let arrivalAnimation = null;
let introFrame = null;
let flights = [];
let introAnimations = [];
let introRun = 0;
let introRunning = false;
let sadIdle = null;
let sadArrival = null;
let sadArriving = false;
let flowRun = 0;
let flowBusy = false;
let flowAnimations = [];
let debitFrame = null;
let recoveryGlow = null;

function syncFlowPlayback() {
  flowAnimations.forEach(animation => {
    if (document.hidden || settings.open) {
      if (animation.playState === 'running') animation.pause();
    } else if (animation.playState === 'paused') animation.play();
  });
}
function trackFlowAnimation(animation) {
  flowAnimations.push(animation);
  syncFlowPlayback();
  return animation;
}
async function animateCoinDebit(run) {
  if (reducedMotion.matches) return;
  const before = state.coins;
  const badge = $('#daily-balance');
  const icon = badge.querySelector('img').getBoundingClientRect();
  const host = rewardScreen.getBoundingClientRect();
  const layer = $('#coin-debit-effects');
  const amount = document.createElement('span');
  amount.className = 'coin-debit-amount';
  amount.textContent = '−120';
  amount.style.right = '24px';
  amount.style.top = `${icon.bottom - host.top + 8}px`;
  layer.append(amount);
  const clock = trackFlowAnimation(amount.animate([
    { opacity: 0, transform: 'translateY(-6px)', offset: 0 },
    { opacity: 1, transform: 'translateY(0)', offset: .16 },
    { opacity: 1, transform: 'translateY(12px)', offset: .7 },
    { opacity: 0, transform: 'translateY(26px)', offset: 1 }
  ], { duration: 900, fill: 'both', easing: 'linear' }));
  for (let i = 0; i < 3; i++) {
    const coin = new Image();
    coin.src = 'assets/gold-single.png';
    coin.alt = '';
    coin.className = 'coin-debit-particle';
    coin.style.left = `${icon.x - host.x + 2}px`;
    coin.style.top = `${icon.y - host.y + 2}px`;
    layer.append(coin);
    const dx = [-30, -6, -43][i];
    trackFlowAnimation(coin.animate([
      { opacity: 0, transform: 'translate(0,0) scale(.8)', offset: 0 },
      { opacity: 1, transform: `translate(${dx * .3}px,12px) scale(1)`, offset: .2 },
      { opacity: 0, transform: `translate(${dx}px,64px) scale(.4) rotate(${i % 2 ? -45 : 40}deg)`, offset: 1 }
    ], { duration: 650, delay: i * 80, fill: 'both', easing: 'cubic-bezier(.25,.1,.25,1)' }));
  }
  trackFlowAnimation(badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 300 }));
  const update = () => {
    if (run !== flowRun) return;
    const progress = Math.min(1, Math.max(0, (clock.currentTime || 0) / 720));
    $('#daily-coins').textContent = (before - Math.round(120 * (1 - (1 - progress) ** 3))).toLocaleString('ru-RU');
    debitFrame = requestAnimationFrame(update);
  };
  update();
  await clock.finished;
  cancelAnimationFrame(debitFrame);
  debitFrame = null;
  if (run === flowRun) $('#daily-coins').textContent = (before - 120).toLocaleString('ru-RU');
}

function syncSadPlayback() {
  const active = state.loss && screen === 'daily' && !document.hidden && !settings.open && !flowBusy;
  if (reducedMotion.matches) {
    sadIdle?.goToAndStop(0, true);
    sadArrival?.pause();
  } else {
    if (active && sadArriving) sadArrival?.play(); else sadArrival?.pause();
    if (active && !sadArriving) sadIdle?.play(); else sadIdle?.pause();
  }
}
function startSadArrival() {
  sadArriving = !reducedMotion.matches;
  $('.bot').classList.toggle('sad-arriving', sadArriving);
  sadIdle?.goToAndStop(0, true);
  sadArrival?.goToAndStop(0, true);
  syncSadPlayback();
}
function stopFlowTransition() {
  flowRun++;
  cancelAnimationFrame(debitFrame);
  debitFrame = null;
  $('#coin-debit-effects').replaceChildren();
  $('#daily-coins').textContent = state.coins.toLocaleString('ru-RU');
  flowAnimations.forEach(animation => animation.cancel());
  flowAnimations = [];
  recoveryGlow?.remove();
  recoveryGlow = null;
  rewardScreen.classList.remove('recovering');
  flowBusy = false;
  rewardScreen.inert = false;
  claimButton.disabled = pending !== null;
  $('#decline-restore').disabled = false;
}
async function changeLossState(restore) {
  if (!state.loss || flowBusy) return;
  if (restore && state.coins < 120) return simulateMissedDay(state.coins, true);
  stopIntro();
  stopFlowTransition();
  const run = flowRun;
  flowBusy = true;
  rewardScreen.inert = true;
  claimButton.disabled = true;
  $('#decline-restore').disabled = true;
  syncIdlePlayback();
  if (restore) rewardScreen.classList.add('recovering');
  const target = $('.days');
  const animate = frames => {
    const animation = trackFlowAnimation(target.animate(frames, { duration: reducedMotion.matches ? 0 : 260, easing: 'ease-in-out', fill: 'both' }));
    return animation.finished;
  };
  try {
    if (restore) {
      await animateCoinDebit(run);
      if (run !== flowRun) return;
      await animateRecovery(run);
      if (run !== flowRun) return;
      stopFlowTransition(); syncIdlePlayback();
      if (!settings.open) claimButton.focus({ preventScroll: true });
      announce('Серия восстановлена за 120 монет. Награда доступна.');
      return;
    }
    await animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(12px)' }]);
    if (run !== flowRun) return;
    state.day = 1;
    state.restored = false;
    state.restarted = true;
    state.loss = false;
    state.claimed = false;
    state.returning = false;
    save(); render(); syncIdlePlayback();
    await animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }]);
    if (run !== flowRun) return;
    stopFlowTransition(); syncIdlePlayback();
    if (!settings.open) claimButton.focus({ preventScroll: true });
    announce('Серия начата заново. Доступна первая награда.');
  } catch { /* Closing or resetting cancels the transition. */ }
}
async function animateRecovery(run) {
  const animate = (element, frames, duration, delay = 0) => trackFlowAnimation(element.animate(frames, {
    duration: reducedMotion.matches ? 0 : duration,
    delay: reducedMotion.matches ? 0 : delay,
    easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'both'
  }));
  // Fade changing copy first; the background, calendar shell and bot stay visible.
  const changing = [$('.info-text'), $('.action-area'), $('.day.current'), $('#daily-balance')];
  await Promise.all(changing.map(element => animate(element, [{ opacity: 1 }, { opacity: 0 }], 160).finished));
  if (run !== flowRun) return;
  const buttonTop = $('.action-area').getBoundingClientRect().top;
  const botLayers = [...$('.bot').children];
  const botOpacity = botLayers.map(element => getComputedStyle(element).opacity);
  const glow = $('#daily-color-spots');
  recoveryGlow = glow.cloneNode();
  recoveryGlow.removeAttribute('id');
  recoveryGlow.setAttribute('aria-hidden', 'true');
  glow.after(recoveryGlow);
  idleAnimation?.goToAndStop(0, true);
  state.coins -= 120;
  state.restored = true;
  state.loss = false;
  state.claimed = false;
  state.returning = false;
  save(); render(); syncIdlePlayback();
  const motions = [
    animate(recoveryGlow, [{ opacity: 1 }, { opacity: 0 }], 640),
    animate(glow, [{ opacity: 0 }, { opacity: 1 }], 640),
    animate($('.info-text'), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], 440, 40),
    animate($('.day.current'), [{ opacity: 0 }, { opacity: 1 }], 440),
    animate($('.action-area'), [
      { opacity: 0, transform: `translateY(${buttonTop - $('.action-area').getBoundingClientRect().top}px)` },
      { opacity: 1, transform: 'translateY(0)' }
    ], 560, 40)
  ];
  botLayers.forEach((element, index) => motions.push(animate(element, [
    { opacity: botOpacity[index] }, { opacity: getComputedStyle(element).opacity }
  ], 600)));
  await Promise.all(motions.map(animation => animation.finished));
}
function simulateMissedDay(coins = state.coins, expired = false) {
  settings.close();
  if (pending) finishCollection();
  stopEffects();
  state.day = state.claimed ? state.day + 1 : Math.max(2, state.day);
  state.claimed = false;
  state.coins = coins;
  state.returning = false;
  state.restored = false;
  state.loss = !expired && coins >= 120;
  state.restarted = !state.loss;
  if (state.restarted) state.day = 1;
  save(); render(); showScreen('daily', true, false);
}

function syncIntroPlayback() {
  introAnimations.forEach(animation => {
    if (document.hidden || settings.open) animation.pause();
    else if (animation.playState === 'paused') animation.play();
  });
}
function stopIntro() {
  introRun++;
  cancelAnimationFrame(introFrame);
  introFrame = null;
  introAnimations.forEach(animation => animation.cancel());
  introAnimations = [];
  introRunning = false;
  rewardScreen.classList.remove('intro-pending');
  rewardScreen.removeAttribute('aria-busy');
  $('#streak-intro').hidden = true;
  $('#intro-color-spots').hidden = true;
  $('.bot').classList.remove('arriving');
  $$('.info-text, .rewards, .action-area, .daily-balance').forEach(el => { el.inert = false; });
  syncIdlePlayback();
}
function startIntro() {
  stopIntro();
  if (reducedMotion.matches || state.loss) return;
  const run = introRun;
  introRunning = true;
  rewardScreen.setAttribute('aria-busy', 'true');
  $('#streak-intro').hidden = false;
  $('#streak-number').textContent = state.day;
  $$('.info-text, .rewards, .action-area, .daily-balance').forEach(el => { el.inert = true; });
  idleAnimation?.goToAndStop(0, true);
  $('.bot').classList.add('arriving');
  arrivalAnimation?.goToAndStop(0, true);
  const styles = getComputedStyle(rewardScreen);
  const enter = styles.getPropertyValue('--intro-ease-in').trim();
  const exit = styles.getPropertyValue('--intro-ease-out').trim();
  const ui = styles.getPropertyValue('--intro-ease-ui').trim();
  const startTime = document.timeline.currentTime;
  const animate = (selector, frames, delay, duration, easing) => {
    const animation = $(selector).animate(frames, { delay, duration, easing, fill: 'both' });
    animation.startTime = startTime;
    introAnimations.push(animation);
    return animation;
  };
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  const rise = distance => [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'translateY(0)' }];
  if (state.day % 5 === 0) {
    $('#intro-color-spots').hidden = false;
    animate('#intro-color-spots', [
      { opacity: 0, offset: 0, easing: enter },
      { opacity: 1, offset: 800 / 3780 },
      { opacity: 1, offset: 2980 / 3780, easing: ui },
      { opacity: 0, offset: 1 }
    ], 0, 3780, 'linear');
    animate('#daily-color-spots', fade, 2980, 800, ui);
  } else {
    animate('#daily-color-spots', fade, 0, 800, enter);
  }
  // One track per text element avoids backwards-fill overriding its entrance.
  for (const [selector, delay, distance] of [['#streak-label', 600, 24], ['#streak-number', 800, 30]]) {
    const duration = 2660 - delay;
    animate(selector, [
      { opacity: 0, transform: `translateY(${distance}px)`, offset: 0, easing: enter },
      { opacity: 1, transform: 'translateY(0)', offset: 600 / duration },
      { opacity: 1, transform: 'translateY(0)', offset: (2000 - delay) / duration, easing: exit },
      { opacity: 0, transform: 'translateY(0)', offset: 1 }
    ], delay, duration, 'linear');
  }
  const textExit = animate('#streak-intro', [{ opacity: 1 }, { opacity: 0 }], 2700, 50, 'steps(1, end)');
  textExit.finished.then(() => { if (run === introRun) $('#streak-intro').hidden = true; }).catch(() => {});
  animate('.bot', fade, 2500, 480, enter);
  animate('.info-text', rise(10), 2980, 800, ui);
  animate('.rewards', rise(12), 3130, 800, ui);
  const buttons = animate('.action-area', rise(14), 3280, 800, ui);
  buttons.finished.then(() => {
    if (run !== introRun) return;
    $$('.info-text, .rewards, .action-area, .daily-balance').forEach(el => { el.inert = false; });
    rewardScreen.removeAttribute('aria-busy');
    $('#streak-intro').hidden = true;
  }).catch(() => {});
  const clock = animate('#reward-screen', [{ visibility: 'visible' }, { visibility: 'visible' }], 0, 4600, 'linear');
  // Drive the 2.6 s source with the shared timeline, fitting its full motion
  // into 2.5–4.6 s and preserving synchronization when the menu pauses it.
  const syncArrival = () => {
    if (run !== introRun) return;
    const progress = Math.max(0, Math.min(1, ((clock.currentTime || 0) - 2500) / 2100));
    if (arrivalAnimation?.isLoaded) arrivalAnimation.goToAndStop(progress * (arrivalAnimation.totalFrames - 1), true);
    introFrame = requestAnimationFrame(syncArrival);
  };
  syncArrival();
  clock.finished.then(() => { if (run === introRun) stopIntro(); }).catch(() => {});
  syncIntroPlayback();
  syncIdlePlayback();
}

function save() { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {} }
function announce(text) { $('#announcement').textContent = text; }
function syncIdlePlayback() {
  syncSadPlayback();
  if (!idleAnimation) return;
  if (reducedMotion.matches) idleAnimation.goToAndStop(0, true);
  else if (screen !== 'daily' || document.hidden || settings.open || introRunning || botJump || state.loss || flowBusy) idleAnimation.pause();
  else idleAnimation.play();
}
if (window.lottie && window.kviziIdleData) {
  idleAnimation = window.lottie.loadAnimation({
    container: $('#bot-idle'), renderer: 'svg', loop: true, autoplay: false,
    animationData: window.kviziIdleData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
  });
  idleAnimation.addEventListener('DOMLoaded', () => {
    $('.bot').classList.add('idle-ready');
    syncIdlePlayback();
  });
  idleAnimation.addEventListener('data_failed', () => $('.bot').classList.remove('idle-ready'));
}
if (window.lottie && window.kviziArrivalData) {
  arrivalAnimation = window.lottie.loadAnimation({
    container: $('#bot-arrival'), renderer: 'svg', loop: false, autoplay: false,
    animationData: window.kviziArrivalData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
  });
  arrivalAnimation.addEventListener('DOMLoaded', () => $('.bot').classList.add('arrival-ready'));
  arrivalAnimation.addEventListener('data_failed', () => $('.bot').classList.remove('arrival-ready'));
}
if (window.lottie && window.kviziSadIdleData && window.kviziSadArrivalData) {
  sadIdle = window.lottie.loadAnimation({ container: $('#bot-sad-idle'), renderer: 'svg', loop: true, autoplay: false, animationData: window.kviziSadIdleData });
  sadArrival = window.lottie.loadAnimation({ container: $('#bot-sad-arrival'), renderer: 'svg', loop: false, autoplay: false, animationData: window.kviziSadArrivalData });
  sadIdle.addEventListener('DOMLoaded', () => { $('.bot').classList.add('sad-idle-ready'); syncSadPlayback(); });
  sadArrival.addEventListener('DOMLoaded', () => { $('.bot').classList.add('sad-arrival-ready'); syncSadPlayback(); });
  sadArrival.addEventListener('complete', () => { sadArriving = false; $('.bot').classList.remove('sad-arriving'); syncSadPlayback(); });
}
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) { sadArriving = false; $('.bot').classList.remove('sad-arriving'); flowAnimations.forEach(a => a.finish()); }
  if (reducedMotion.matches) stopIntro();
  if (reducedMotion.matches && botJump) botJump.finish();
  syncIdlePlayback();
  if (flightRunning && reducedMotion.matches) finishCollection('daily');
});
document.addEventListener('visibilitychange', () => { syncIdlePlayback(); syncIntroPlayback(); syncFlowPlayback(); });

function hideTooltip() {
  tooltip.hidden = true;
  $('#info').setAttribute('aria-expanded', 'false');
}
function showScreen(next, focus = true, intro = false) {
  stopFlowTransition();
  stopIntro();
  screen = next;
  rewardScreen.hidden = next !== 'daily';
  revealScreen.hidden = next !== 'reveal';
  closedScreen.hidden = next !== 'closed';
  hideTooltip();
  if (next === 'daily' && state.loss) startSadArrival();
  if (next === 'daily' && intro) startIntro();
  syncIdlePlayback();
  if (focus && !settings.open) {
    $('.phone').scrollIntoView({ block: 'start', behavior: 'instant' });
    if (next === 'daily') (introRunning || state.claimed ? $('#close-screen') : claimButton).focus({ preventScroll: true });
    if (next === 'reveal') $('#collect-reward').focus({ preventScroll: true });
    if (next === 'closed') $('#reopen').focus({ preventScroll: true });
  }
}
function render() {
  const isCoins = state.day % 5 === 0;
  const firstDay = Math.floor((state.day - 1) / 5) * 5 + 1;
  rewardScreen.classList.toggle('gold-mode', isCoins);
  rewardScreen.classList.toggle('loss-mode', !!state.loss);
  rewardScreen.classList.toggle('restart-mode', !!state.restarted);
  $('#daily-color-spots').src = `assets/${state.loss ? 'color-spots-red.png' : isCoins ? 'color-spots-gold.png' : 'color-spots.png'}`;
  $('#reward-title').textContent = state.loss ? 'Вы пропустили день в игре' : state.restarted ? 'Начинаем сначала — забирайте награду' : state.claimed ? 'Награда уже ваша!' : state.returning ? 'С возвращением! Мы скучали' : isCoins ? 'Сегодня — особенная награда' : state.day > 1 ? 'Новый день — новая награда' : 'Вот ваша первая награда';
  $('#reward-description').innerHTML = state.loss ? 'Можно восстановить<br>прогресс за монеты' : state.claimed
    ? `Вы получили ${isCoins ? '299 монет' : '3 единицы энергии'}.<br>Возвращайтесь завтра за новой наградой`
    : state.restored ? 'Заходите в Квизи каждый день<br>и получайте награды'
    : 'Заходите в «Квизи» каждый день, чтобы<br class="wide-break"> не потерять прогресс';
  claimButton.disabled = pending !== null || flowBusy;
  claimButton.innerHTML = state.loss ? '<span>Восстановить за 120</span><img src="assets/gold-single.png" alt="монет" width="24" height="24">' : state.claimed ? 'Следующий день' : `<span>Забрать ${isCoins ? '299' : '3'}</span><img src="assets/${isCoins ? 'gold-single.png' : 'energy-single.png'}" alt="${isCoins ? 'монет' : 'единицы энергии'}" width="24" height="24">`;
  $('#decline-restore').hidden = !state.loss;
  $('.rewards').setAttribute('aria-label', `Награды за дни ${firstDay}–${firstDay + 4}`);
  $$('.day').forEach((day, index) => {
    const n = firstDay + index;
    const completed = n < state.day || (n === state.day && (state.claimed || pending));
    const current = n === state.day && !completed;
    day.classList.toggle('current', !!current);
    day.classList.toggle('completed', !!completed);
    day.setAttribute('aria-label', `День ${n}: ${n % 5 === 0 ? '299 монет' : '3 единицы энергии'}, ${state.loss && current ? 'пропущено' : completed ? 'получено' : current ? 'доступно' : 'пока недоступно'}`);
    day.querySelector('.day-label').textContent = `День ${n}`;
    if (index < 4) day.querySelector('.reward-tile img').src = `assets/energy-${current || completed ? 'purple' : 'gray'}.png`;
  });
  $('#closed-description').textContent = state.loss ? 'Пропущенный день можно восстановить за 120 монет.' : state.claimed ? 'Сегодняшняя награда получена. Возвращайтесь завтра!' : 'Ваша ежедневная награда ждёт вас.';
  $('#demo-day').value = String(state.day);
  $('#next-day').disabled = !state.claimed || pending !== null;
  $('#replay-intro').disabled = !!state.loss;
  $('#demo-status').textContent = `День ${state.day} · ${state.loss ? 'день пропущен' : state.claimed ? 'награда получена' : pending ? 'получение награды' : 'награда доступна'}`;
  $('#demo-energy').textContent = state.energy;
  $('#demo-coins').textContent = state.coins;
  $('#daily-coins').textContent = state.coins.toLocaleString('ru-RU');
  $('#daily-balance').hidden = !state.loss;
  $('#daily-balance').setAttribute('aria-label', `Баланс монет: ${state.coins}`);
}
function $$(selector) { return [...document.querySelectorAll(selector)]; }
function updateBalance(value) {
  $('#balance-value').textContent = value;
  $('#balance-badge').setAttribute('aria-label', `Баланс ${pending?.kind === 'coins' ? 'монет' : 'энергии'}: ${value}`);
}
function revealReward() {
  if (pending || state.claimed || state.loss || flowBusy) return;
  stopIntro();
  const kind = state.day % 5 === 0 ? 'coins' : 'energy';
  pending = { kind, amount: kind === 'coins' ? 299 : 3, before: state[kind], day: state.day };
  render();
  hideTooltip();
  revealScreen.classList.remove('is-flying');
  revealScreen.classList.toggle('gold-mode', kind === 'coins');
  $('.reward-glow').src = `assets/${kind === 'coins' ? 'reward-glow-gold.png' : 'reward-glow.png'}`;
  $$('.reward-particles').forEach(img => { img.src = `assets/${kind === 'coins' ? 'particles-gold.png' : 'particles.png'}`; });
  $('#collect-reward').disabled = false;
  $('#balance-icon').src = `assets/${kind === 'coins' ? 'gold-single.png' : 'flying-energy.png'}`;
  $('#reveal-art').src = `assets/${kind === 'coins' ? 'gold-single.png' : 'energy-purple.png'}`;
  $('#reveal-quantity').textContent = `x${pending.amount}`;
  updateBalance(pending.before);
  const reward = pending;
  const openReward = () => {
    if (pending !== reward || screen !== 'daily') return;
    botJump = null;
    showScreen('reveal');
    announce(`Ваша награда: ${pending.amount} ${kind === 'coins' ? 'монет' : 'единицы энергии'}. Коснитесь, чтобы продолжить.`);
  };
  if (reducedMotion.matches) return openReward();
  botJump = $('.bot').animate([
    { transform: 'translateY(0) scale(1)', offset: 0 },
    { transform: 'translateY(3px) scale(1.04,.95)', offset: .16, easing: 'cubic-bezier(.16,1,.3,1)' },
    { transform: 'translateY(-28px) scale(.98,1.03)', offset: .48, easing: 'cubic-bezier(.55,0,.85,.45)' },
    { transform: 'translateY(2px) scale(1.04,.96)', offset: .82, easing: 'ease-out' },
    { transform: 'translateY(0) scale(1)', offset: 1 }
  ], { duration: 620, fill: 'both', easing: 'linear' });
  flights.push(botJump);
  syncIdlePlayback();
  botJump.finished.then(openReward).catch(() => {});
}
function stopEffects() {
  stopFlowTransition();
  clearTimeout(transitionTimer);
  transitionTimer = null;
  animationRun++;
  flights.forEach(a => a.cancel());
  flights = [];
  botJump = null;
  $('#flying-rewards').replaceChildren();
  flightRunning = false;
}
function finishCollection(destination = 'daily') {
  if (!pending) return;
  const reward = pending;
  stopEffects();
  state[reward.kind] = reward.before + reward.amount;
  state.claimed = true;
  state.returning = false;
  state.restarted = false;
  pending = null;
  save();
  render();
  showScreen(destination);
  announce(`Получено ${reward.amount} ${reward.kind === 'coins' ? 'монет' : 'единицы энергии'}. Баланс: ${state[reward.kind]}.`);
}
async function collectReward() {
  if (!pending || flightRunning) return;
  flightRunning = true;
  $('#collect-reward').disabled = true;
  revealScreen.classList.add('is-flying');
  if (reducedMotion.matches) return finishCollection();
  const run = ++animationRun;
  const origin = $('#reveal-art').getBoundingClientRect();
  const target = $('#balance-icon').getBoundingClientRect();
  const host = revealScreen.getBoundingClientRect();
  const sx = origin.x + origin.width / 2 - host.x;
  const sy = origin.y + origin.height / 2 - host.y;
  const dx = target.x + target.width / 2 - host.x - sx;
  const dy = target.y + target.height / 2 - host.y - sy;
  const count = pending.kind === 'coins' ? 5 : 3;
  let arrived = 0;
  const jobs = Array.from({ length: count }, (_, i) => {
    const img = new Image();
    img.src = `assets/${pending.kind === 'coins' ? 'gold-single.png' : 'flying-energy.png'}`;
    img.className = 'flying-energy';
    img.alt = '';
    img.style.left = `${sx - 24}px`;
    img.style.top = `${sy - 24}px`;
    $('#flying-rewards').append(img);
    const swing = [-30, 8, -14, 16, -20][i];
    const a = img.animate([
      { transform: 'translate(0,0) scale(.7) rotate(-12deg)', opacity: 0, offset: 0 },
      { transform: `translate(${swing}px,-25px) scale(1.12) rotate(12deg)`, opacity: 1, offset: .16 },
      { transform: `translate(${dx * .72 + swing}px,${dy * .5}px) scale(.95) rotate(-14deg)`, opacity: 1, offset: .55 },
      { transform: `translate(${dx}px,${dy}px) scale(.38) rotate(8deg)`, opacity: 1, offset: .93 },
      { transform: `translate(${dx}px,${dy}px) scale(.2)`, opacity: 0, offset: 1 }
    ], { duration: 1250, delay: i * 180, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'both' });
    flights.push(a);
    return a.finished.then(() => {
      if (run !== animationRun || !pending) return;
      arrived++;
      updateBalance(pending.before + (pending.kind === 'coins' ? Math.round(pending.amount * arrived / count) : arrived));
      const bump = $('#balance-badge').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220 });
      flights.push(bump);
      img.remove();
    }).catch(() => {});
  });
  await Promise.all(jobs);
  if (run !== animationRun || !pending) return;
  transitionTimer = setTimeout(() => finishCollection(), 450);
}
function closeScreen() {
  if (pending) finishCollection('closed');
  else showScreen('closed');
}
function resetPrototype() {
  settings.close();
  stopEffects();
  pending = null;
  state = initialState();
  save(); render(); showScreen('daily', true, true);
  announce('Прототип сброшен. Доступна первая награда.');
}
function setDay(day, returning = false) {
  if (!Number.isSafeInteger(day) || day < 1 || day > Number.MAX_SAFE_INTEGER - 5) return;
  settings.close();
  if (pending) finishCollection();
  stopEffects();
  state.day = day;
  state.claimed = false;
  state.returning = returning;
  state.loss = false;
  state.restarted = false;
  state.restored = false;
  save(); render(); showScreen('daily', true, true);
}
claimButton.addEventListener('click', () => {
  if (flowBusy) return;
  if (state.loss) changeLossState(true);
  else if (state.claimed) setDay(state.day + 1);
  else revealReward();
});
$('#collect-reward').addEventListener('click', collectReward);
$('#decline-restore').addEventListener('click', () => changeLossState(false));
$('#close-screen').addEventListener('click', closeScreen);
$('#close-reveal').addEventListener('click', closeScreen);
$('#reopen').addEventListener('click', () => showScreen('daily', true, true));
$('#replay-intro').addEventListener('click', () => {
  settings.close();
  if (pending) finishCollection();
  showScreen('daily', true, true);
});
$('#demo-reset').addEventListener('click', resetPrototype);
$('#open-settings').addEventListener('click', () => {
  hideTooltip();
  render();
  settings.showModal();
  syncIntroPlayback();
  [...flights, ...flowAnimations].forEach(animation => { if (animation.playState === 'running') animation.pause(); });
  syncIdlePlayback();
});
$('#close-settings').addEventListener('click', () => settings.close());
settings.addEventListener('close', () => {
  syncIntroPlayback();
  [...flights, ...flowAnimations].forEach(animation => { if (animation.playState === 'paused') animation.play(); });
  syncIdlePlayback();
});
settings.addEventListener('click', event => {
  if (event.target !== settings) return;
  const rect = settings.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) settings.close();
});
$('#demo-day').addEventListener('input', event => event.target.setCustomValidity(''));
$('#day-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#demo-day');
  const day = Number(input.value);
  if (!Number.isSafeInteger(day) || day < 1 || day > Number.MAX_SAFE_INTEGER - 5) {
    input.setCustomValidity('Введите целый положительный номер дня.');
    input.reportValidity();
    return;
  }
  setDay(day);
});
$('#next-day').addEventListener('click', () => { if (state.claimed) setDay(state.day + 1); });
$('#missed-day').addEventListener('click', () => simulateMissedDay(10000));
$('#missed-no-coins').addEventListener('click', () => simulateMissedDay(0));
$('#long-break').addEventListener('click', () => simulateMissedDay(state.coins, true));
$('#info').addEventListener('click', () => {
  tooltip.hidden = !tooltip.hidden;
  $('#info').setAttribute('aria-expanded', String(!tooltip.hidden));
});
document.addEventListener('click', event => { if (!event.target.closest('#info, #reward-tooltip')) hideTooltip(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !tooltip.hidden) { hideTooltip(); $('#info').focus(); }
});
render();
showScreen('daily', false, true);
