// Hero video controls and copy buttons.
(() => {
    const fig = document.querySelector('.hero-video');
    const vid = document.getElementById('hero-vid');
    const play = document.getElementById('hero-play');
    const mute = document.getElementById('hero-mute');
    const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
    ).matches;

    const syncPlay = () => {
        const paused = vid.paused;
        play.dataset.state = paused ? 'paused' : 'playing';
        play.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
    };
    // Stable name ("Sound"); aria-pressed alone carries whether sound is on.
    const syncMute = () =>
        mute.setAttribute('aria-pressed', String(!vid.muted));
    // play() rejects when the browser blocks playback; keep the controls
    // truthful instead of leaving an unhandled rejection.
    const tryPlay = () =>
        vid.play().catch(() => {
            vid.muted = true;
            syncMute();
            syncPlay();
        });

    // If the video can't load, the poster stays up; hide controls that
    // would do nothing.
    vid.addEventListener('error', () => fig.classList.add('no-video'));
    vid.addEventListener('play', syncPlay);
    vid.addEventListener('pause', syncPlay);
    // No autoplay attribute: start only once we know motion is welcome.
    if (!reduceMotion) tryPlay();
    syncPlay();

    play.addEventListener('click', () =>
        vid.paused ? tryPlay() : vid.pause(),
    );
    mute.addEventListener('click', () => {
        vid.muted = !vid.muted;
        if (!vid.muted) vid.currentTime = 0;
        syncMute();
        if (!vid.muted) tryPlay();
    });

    document.querySelectorAll('.copy').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.copy);
                btn.textContent = 'Copied';
            } catch {
                // Clipboard blocked (permissions / insecure context): select
                // the command so a manual copy grabs exactly the right text.
                const code = btn.parentElement.querySelector('code');
                const range = document.createRange();
                range.selectNodeContents(code);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                btn.textContent = 'Selected: press Ctrl+C';
            }
            setTimeout(() => (btn.textContent = 'Copy'), 2400);
        });
    });
})();
