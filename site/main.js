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

// Feature tour: chapter buttons from the cut's chapters file, so the list
// always matches the rendered video (scripts/build-feature-video.mjs). Fetched
// directly: a lazy-loaded <video> also defers its text tracks.
(() => {
    const vid = document.getElementById('tour-vid');
    const trackEl = document.getElementById('tour-chapters');
    const list = document.getElementById('tour-chapter-list');
    if (!vid || !trackEl || !list) return;
    const secs = (t) =>
        t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
    const stamp = (s) =>
        `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const jump = (start) => {
        const go = () => {
            vid.currentTime = start;
            vid.play().catch(() => {});
        };
        if (vid.readyState >= HTMLMediaElement.HAVE_METADATA) return go();
        // A chapter click asks to watch now: lift lazy loading, and seek only
        // once metadata is in (with preload="none" an earlier seek is dropped).
        vid.removeAttribute('loading');
        vid.addEventListener('loadedmetadata', go, { once: true });
        vid.load();
    };
    fetch(trackEl.getAttribute('src'))
        .then((res) => (res.ok ? res.text() : ''))
        .then((vtt) => {
            for (const block of vtt.split(/\r?\n\r?\n/)) {
                const [timing, ...text] = block.trim().split(/\r?\n/);
                const match = /^([\d:.]+)\s+-->/.exec(timing ?? '');
                if (!match || !text.length) continue;
                const start = secs(match[1]);
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                const time = document.createElement('time');
                time.textContent = stamp(start);
                btn.append(time, text.join(' '));
                btn.addEventListener('click', () => jump(start));
                li.append(btn);
                list.append(li);
            }
        })
        .catch(() => {});
})();
