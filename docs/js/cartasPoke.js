const card = document.getElementById('pokemon-card');

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

function handleMove(e) {
    const rect = card.getBoundingClientRect();
    let x, y;

    if (e.type === 'touchmove') {
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
    } else {
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
    }

    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;

    const center = {
        x: px - 50,
        y: py - 50
    };

    const pointerFromCenter = clamp(Math.sqrt(center.x * center.x + center.y * center.y) / 50, 0, 1);

    card.style.setProperty('--pointer-x', `${px}%`);
    card.style.setProperty('--pointer-y', `${py}%`);
    card.style.setProperty('--background-x', `${px}%`);
    card.style.setProperty('--background-y', `${py}%`);
    card.style.setProperty('--pointer-from-center', pointerFromCenter);
    card.style.setProperty('--pointer-from-top', py / 100);
    card.style.setProperty('--pointer-from-left', px / 100);

    const rx = -(center.x / 3.5);
    const ry = (center.y / 3.5);

    card.style.setProperty('--rotate-x', `${rx}deg`);
    card.style.setProperty('--rotate-y', `${ry}deg`);
    card.style.setProperty('--card-opacity', '1');

    card.classList.add('interacting');
}

function handleEnd() {
    card.style.setProperty('--card-opacity', '0');
    card.style.setProperty('--rotate-x', '0deg');
    card.style.setProperty('--rotate-y', '0deg');
    card.style.setProperty('--pointer-x', '50%');
    card.style.setProperty('--pointer-y', '50%');
    card.style.setProperty('--background-x', '50%');
    card.style.setProperty('--background-y', '50%');
    card.classList.remove('interacting');
}

card.addEventListener('mousemove', handleMove);
card.addEventListener('touchmove', handleMove);
card.addEventListener('mouseleave', handleEnd);
card.addEventListener('touchend', handleEnd);

const raritySelect = document.getElementById('rarity-select');
if (raritySelect) {
    raritySelect.addEventListener('change', (e) => {
        const val = e.target.value;
        card.setAttribute('data-rarity', val);

        // Handle special attributes for certain rarities
        if (val.includes('trainer gallery')) {
            card.setAttribute('data-trainer-gallery', 'true');
        } else {
            card.removeAttribute('data-trainer-gallery');
        }
    });
}

// Random seed for cosmos effect
const randomSeed = {
    x: Math.random(),
    y: Math.random()
};
card.style.setProperty('--seedx', randomSeed.x);
card.style.setProperty('--seedy', randomSeed.y);
card.style.setProperty('--cosmosbg', `${Math.floor(randomSeed.x * 734)}px ${Math.floor(randomSeed.y * 1280)}px`);
