let isDragging = false;
let isMoving = false;
let isManualPageTurn = false;
let startX, startY;

$(document).ready(async function() {
    // --- Mobile Interaction Priority (Priority over turn.js) ---
    // Interceptamos eventos en la fase de captura para evitar que turn.js
    // detecte el toque si el usuario está interactuando con un botón.
    const protectedElements = '.zoom-btn, #close-btn, .nav-btn, #clear-search';

    const stopInterference = (e) => {
        if (e.target.closest(protectedElements)) {
            // Detenemos la propagación en fase de captura.
            // Esto evita que el evento llegue a los listeners de turn.js
            e.stopPropagation();
        }
    };

    // Bloqueamos touchstart y mousedown en fase de captura
    document.addEventListener('touchstart', stopInterference, true);
    document.addEventListener('mousedown', stopInterference, true);
    document.addEventListener('pointerdown', stopInterference, true);

    if ($.isTouch === undefined) {
        $.isTouch = 'ontouchstart' in window;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const initialView = urlParams.get('view') || 'albums';

    loadStoreData();

    $('.nav-btn').click(function() {
        const view = $(this).data('view');
        switchView(view);
    });

    if (initialView === 'decks') {
        switchView('decks');
    }

    // --- Card Interaction Logic (Click Protection) ---
    $(document).on("touchstart mousedown", ".card-slot", function(e) {
        isDragging = false;
        const ev = e.type.startsWith('touch') ? e.originalEvent.touches[0] : e;
        startX = ev.pageX;
        startY = ev.pageY;
    });

    $(document).on("touchmove mousemove", ".card-slot", function(e) {
        if (startX === undefined || startY === undefined) return;
        const ev = e.type.startsWith('touch') ? e.originalEvent.touches[0] : e;
        if (Math.abs(ev.pageX - startX) > 5 || Math.abs(ev.pageY - startY) > 5) {
            isDragging = true;
        }
    });

    $(document).on("touchend mouseup", function() {
        startX = undefined;
        startY = undefined;
        setTimeout(() => { isDragging = false; }, 100);
    });

    // Delegated click handler as a fallback for desktop or cards without direct listeners
    $(document).on("click", ".card-slot", function(e) {
        if (isDragging) return;
        const $slot = $(this);

        // On mobile, the zoom button handles the click directly to avoid turn.js interference.
        // If we are here on mobile and it's not the zoom button, we ignore it.
        const isMobile = window.innerWidth <= 640;
        if (isMobile) {
            if (!$(e.target).closest('.zoom-btn').length) {
                return;
            }
        }

        if ($slot.closest('.album').length > 0) {
            e.stopPropagation();
        }
        openCardModal($slot);
    });

    $(document).on("click", "#close-btn, #image-overlay", function(e) {
        if (e.target === this || $(this).attr('id') === 'close-btn') {
            $("#image-overlay").removeClass("active");
            $("body").removeClass("modal-open");

            // Clean up 3D effects
            card3dActive = false;
            if (card3dOrientationHandler) {
                window.removeEventListener('deviceorientation', card3dOrientationHandler);
                card3dOrientationHandler = null;
            }
        }
    });

    // Search Logic with Debounce
    let searchTimeout;
    $('#search-input').on('input', function() {
        const query = $(this).val().toLowerCase().trim();
        clearTimeout(searchTimeout);

        if (query.length > 0) {
            $('#clear-search').show();
            searchTimeout = setTimeout(() => {
                filterContent(query);
            }, 300); // 300ms debounce
        } else {
            $('#clear-search').hide();
            resetFilter();
        }
    });

    $('#clear-search').click(function() {
        $('#search-input').val('');
        $(this).hide();
        resetFilter();
    });
});

function filterContent(query) {
    let anyVisible = false;
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);

    if (keywords.length === 0) {
        resetFilter();
        return;
    }

    // Clear previous highlights
    $('.search-highlight').removeClass('search-highlight');

    // Filtrar álbumes
    $('.public-album-item').each(function() {
        const $albumItem = $(this);
        const albumTitle = $albumItem.find('.public-album-header').text().toLowerCase();

        // El álbum coincide si el título contiene TODOS los keywords
        let albumTitleMatch = keywords.every(k => albumTitle.includes(k));

        let firstMatchPage = -1;
        let anyCardMatches = false;

        $albumItem.find('.card-slot').each(function() {
            const $slot = $(this);
            const cardName = ($slot.attr('data-name') || '').toLowerCase();

            // La búsqueda debe ser insensible a mayúsculas/minúsculas y buscar en data-name
            const cardMatch = cardName && keywords.every(k => cardName.includes(k));

            if (cardMatch) {
                anyCardMatches = true;
                $slot.addClass('search-highlight');
                if (firstMatchPage === -1) {
                    // Usar el atributo data-page pre-calculado para mayor fiabilidad
                    firstMatchPage = parseInt($slot.attr('data-page')) || -1;
                }
            }
        });

        if (albumTitleMatch || anyCardMatches) {
            $albumItem.show();
            anyVisible = true;
            // Si hubo coincidencia en cartas, girar a la primera página que coincide usando turn.js
            if (anyCardMatches && firstMatchPage !== -1) {
                const $turnAlbum = $albumItem.find('.album');
                if ($turnAlbum.turn('is')) {
                    const currentPage = $turnAlbum.turn('page');
                    // En modo double, las páginas vienen en pares (2-3, 4-5, etc.)
                    // Verificamos si la página destino ya está visible
                    const isAlreadyVisible = (currentPage === firstMatchPage) ||
                                           (currentPage % 2 === 0 && currentPage + 1 === firstMatchPage) ||
                                           (currentPage % 2 !== 0 && currentPage - 1 === firstMatchPage && currentPage > 1);

                    if (!isAlreadyVisible) {
                        isManualPageTurn = true;
                        $turnAlbum.turn('page', firstMatchPage);
                        // Aumentamos el tiempo del flag para asegurar que termine la animación
                        setTimeout(() => { isManualPageTurn = false; }, 1500);
                    }
                }
            }
        } else {
            $albumItem.hide();
        }
    });

    // Filtrar decks
    $('.deck-public-item').each(function() {
        const $deck = $(this);
        const deckName = $deck.find('h3').text().toLowerCase();

        let deckNameMatch = keywords.every(k => deckName.includes(k));
        let anyCardMatches = false;
        let firstMatchIndex = -1;

        $deck.find('.swiper-slide').each(function(index) {
            const $slot = $(this);
            const cardName = ($slot.attr('data-name') || '').toLowerCase();
            const cardMatch = cardName && keywords.every(k => cardName.includes(k));

            if (cardMatch) {
                anyCardMatches = true;
                $slot.addClass('search-highlight');
                if (firstMatchIndex === -1) firstMatchIndex = index;
            }
        });

        if (deckNameMatch || anyCardMatches) {
            $deck.show();
            anyVisible = true;
            if (anyCardMatches && firstMatchIndex !== -1) {
                const swiperEl = $deck.find('.swiper')[0];
                if (swiperEl && swiperEl.swiper) {
                    swiperEl.swiper.slideTo(firstMatchIndex);
                }
            }
        } else {
            $deck.hide();
        }
    });

    if (anyVisible) {
        $('#no-results').hide();
    } else {
        $('#no-results').show();
    }
}

function resetFilter() {
    $('.public-album-item, .deck-public-item').show();
    $('.search-highlight').removeClass('search-highlight');
    $('#no-results').hide();
}

let card3dZtext = null;
let targetRX = 0;
let targetRY = 0;
let currentRX = 0;
let currentRY = 0;
let card3dActive = false;
let card3dOrientationHandler = null;
let card3dTouchHandler = null;

function updateRotation() {
    if (!card3dActive) return;

    // LERP for smooth motion
    currentRX += (targetRX - currentRX) * 0.1;
    currentRY += (targetRY - currentRY) * 0.1;

    const $card = $('#card-3d');
    if ($card.length) {
        $card.css('transform', `rotateX(${currentRX}deg) rotateY(${currentRY}deg)`);

        // Update holo effects variables
        const mx = (currentRY + 20) / 40;
        const my = (currentRX + 20) / 40;
        const angle = (Math.atan2(currentRX, currentRY) * 180 / Math.PI) + 135;

        $card.css({
            '--mx': mx,
            '--my': my,
            '--angle': `${angle}deg`
        });
    }

    requestAnimationFrame(updateRotation);
}

function init3DCard() {
    const $container = $('#card-3d-container');
    const $card = $('#card-3d');
    const $zContainer = $('#z-text-container');

    if (!$zContainer.length) return;

    // Reset styles
    $card.css('transform', '');
    currentRX = 0;
    currentRY = 0;
    targetRX = 0;
    targetRY = 0;

    // Initialize ztext
    try {
        card3dZtext = new Ztextify('#z-text-container', {
            depth: "10px",
            layers: 10,
            fade: true,
            direction: "backwards",
            event: "none",
            perspective: "800px"
        });
    } catch (e) {
        console.error("Ztext init error:", e);
    }

    $container.off('mousemove mouseleave touchend');
    if (card3dTouchHandler) {
        $container[0].removeEventListener('touchmove', card3dTouchHandler);
    }

    $container.on('mousemove', (e) => {
        const rect = $container[0].getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        targetRY = ((x / rect.width) - 0.5) * 40;
        targetRX = ((y / rect.height) - 0.5) * -40;
    });

    $container.on('mouseleave', () => {
        targetRX = 0;
        targetRY = 0;
    });

    // Touch support - use native listener with {passive: false} to allow e.preventDefault()
    card3dTouchHandler = (e) => {
        const rect = $container[0].getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        targetRY = ((x / rect.width) - 0.5) * 40;
        targetRX = ((y / rect.height) - 0.5) * -40;

        if (e.cancelable) e.preventDefault();
    };

    $container[0].addEventListener('touchmove', card3dTouchHandler, { passive: false });

    $container.on('touchend', () => {
        targetRX = 0;
        targetRY = 0;
    });

    // Device Orientation support
    if (window.DeviceOrientationEvent) {
        if (card3dOrientationHandler) {
            window.removeEventListener('deviceorientation', card3dOrientationHandler);
        }
        card3dOrientationHandler = (e) => {
            if (!card3dActive) return;
            if (e.gamma !== null && e.beta !== null) {
                targetRY = Math.max(-20, Math.min(20, e.gamma)) * 1.5;
                targetRX = Math.max(-20, Math.min(20, e.beta - 45)) * 1.5;
            }
        };

        // iOS 13+ requires permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(state => {
                    if (state === 'granted') {
                        window.addEventListener('deviceorientation', card3dOrientationHandler);
                    }
                })
                .catch(err => console.error("Gyroscope permission denied:", err));
        } else {
            window.addEventListener('deviceorientation', card3dOrientationHandler);
        }
    }

    if (!card3dActive) {
        card3dActive = true;
        requestAnimationFrame(updateRotation);
    }
}

function openCardModal($slot) {
    const imgSrc = $slot.find("img").attr("src");

    if (!imgSrc || imgSrc.includes('placeholder')) return;

    const name = $slot.data("name") || "Carta de Colección";
    const rarity = $slot.data("rarity") || "-";
    const holo = $slot.data("holo") || "";
    const mask = $slot.data("mask") || "";
    const expansion = $slot.data("expansion") || "-";
    const condition = $slot.data("condition") || "-";
    const quantity = $slot.data("quantity") || "1";
    const price = $slot.data("price") || "-";

    // Reset the card container with a fresh image tag and preserve holo-layer
    $("#card-3d").html(`
        <div id="z-text-container">
            <img id="expanded-image" src="${imgSrc}" alt="${name}">
        </div>
        <div class="holo-layer"></div>
    `);

    const $card3d = $("#card-3d-container");
    $card3d.removeClass("super-rare secret-rare ghost-rare foil rainbow custom-texture active");
    $card3d.find('.holo-layer').css('--mask-url', '');

    if (holo) {
        $card3d.addClass(holo);
        if (holo === 'custom-texture' && mask) {
            $card3d.find('.holo-layer').css('--mask-url', `url(${mask})`);
        }
    }

    $("#card-name").text(name);
    $("#card-rarity").text(rarity);
    $("#card-expansion").text(expansion);
    $("#card-condition").text(condition);
    $("#card-quantity").text(quantity);
    $("#card-price").text(price);

    $("#image-overlay").addClass("active");
    $("body").addClass("modal-open");

    // Defer initialization to allow DOM update
    setTimeout(() => {
        init3DCard();
        $card3d.addClass("active");
    }, 150);
}

async function switchView(view) {
    $('.nav-btn').removeClass('active');
    $(`.nav-btn[data-view="${view}"]`).addClass('active');

    $('.view-section').removeClass('active');
    $(`#${view}-view`).addClass('active');

    if (view === 'albums') {
        $('#public-view-title').text('Colección de Álbumes');
    } else {
        $('#public-view-title').text('Decks de Cartas');
        loadPublicDecks();
    }

    const url = new URL(window.location);
    url.searchParams.set('view', view);
    window.history.pushState({}, '', url);
}

async function loadStoreData() {
    const urlParams = new URLSearchParams(window.location.search);
    const storeName = urlParams.get('store');

    if (!storeName) {
        $('#public-store-name').hide();
        return;
    }

    const { data: userData, error: userError } = await _supabase
        .from('usuarios')
        .select('id, store_name')
        .eq('store_name', storeName)
        .single();

    if (userError || !userData) {
        $('#albums-container').html('<div class="error">Tienda no encontrada.</div>');
        return;
    }

    $('#public-store-name').text(`Tienda: ${userData.store_name}`);

    loadPublicAlbums(userData.id);
}

async function loadPublicAlbums(userId) {
    let query = _supabase
        .from('albums')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: true });

    let { data: albums, error } = await query;

    // Fallback if query failed (might be schema mismatch)
    if (error) {
        console.warn("Error al cargar álbumes, intentando consulta básica.");
        const retry = await _supabase
            .from('albums')
            .select('*')
            .eq('user_id', userId)
            .order('id', { ascending: true });
        albums = retry.data;
        error = retry.error;
    }

    if (albums) {
        // Filtrar en JS para tratar null como público (true)
        // Solo ocultamos si is_public es explícitamente false
        albums = albums.filter(a => a.is_public !== false);
    }

    if (error) {
        $('#albums-container').html('<div class="error">Error al cargar álbumes.</div>');
        return;
    }

    if (albums.length === 0) {
        $('#albums-container').html('<div class="empty">No hay álbumes disponibles.</div>');
        return;
    }

    $('#albums-container').empty();
    for (const album of albums) {
        await renderAlbum(album);
    }
}

async function loadPublicDecks() {
    const storeName = new URLSearchParams(window.location.search).get('store');
    if (!storeName) return;

    $('#decks-container').html('<div class="loading">Cargando decks...</div>');

    const { data: user } = await _supabase
        .from('usuarios')
        .select('id')
        .eq('store_name', storeName)
        .single();

    if (!user) return;

    let query = _supabase
        .from('decks')
        .select(`
            *,
            deck_cards (*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    let { data: decks, error } = await query;

    // Fallback if query failed
    if (error) {
        console.warn("Error al cargar decks, intentando consulta básica.");
        const retry = await _supabase
            .from('decks')
            .select(`
                *,
                deck_cards (*)
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        decks = retry.data;
        error = retry.error;
    }

    if (decks) {
        // Filtrar en JS para tratar null como público (true)
        decks = decks.filter(d => d.is_public !== false);
    }

    if (error || !decks) {
        $('#decks-container').html('<div class="error">No se pudieron cargar los decks.</div>');
        return;
    }

    $('#decks-container').empty();
    if (decks.length === 0) {
        $('#decks-container').html('<div class="empty">Esta tienda aún no tiene decks públicos.</div>');
        return;
    }

    decks.forEach(deck => {
        const deckId = `deck-swiper-${deck.id}`;
        const $deckItem = $(`
            <div class="deck-public-item">
                <h3>${deck.name}</h3>
                <div class="container">
                    <div class="swiper swiperyg ${deckId}">
                        <div class="swiper-wrapper">
                            ${deck.deck_cards.map(card => `
                                <div class="swiper-slide card-slot"
                                     data-name="${card.name || ''}"
                                     data-rarity="${card.rarity || ''}"
                                     data-holo="${card.holo_effect || ''}"
                                     data-mask="${card.custom_mask_url || ''}"
                                     data-expansion="${card.expansion || ''}"
                                     data-condition="${card.condition || ''}"
                                     data-quantity="${card.quantity || '1'}"
                                     data-price="${card.price || ''}">
                                    <img src="${card.image_url}" alt="${card.name || 'Carta'}" />
                                    <div class="zoom-btn"><i class="fas fa-search-plus"></i></div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `);

        $('#decks-container').append($deckItem);

        // El manejo de clics se mantiene normal, la prioridad táctil
        // ya se maneja con el listener global en fase de captura.
        $deckItem.find('.zoom-btn').on('click', function(e) {
            e.stopPropagation();
            openCardModal($(this).closest('.card-slot'));
        });

        new Swiper(`.${deckId}`, {
            effect: "cards",
            grabCursor: true,
            perSlideOffset: 8,
            perSlideRotate: 2,
            rotate: true,
            slideShadows: true,
            preventClicksPropagation: false,
            on: {
                click: function(s, e) {
                    if (!isDragging) {
                        const $slot = $(e.target).closest('.card-slot');
                        if ($slot.length) {
                            const isMobile = window.innerWidth <= 640;
                            if (isMobile) {
                                if (!$(e.target).closest('.zoom-btn').length) return;
                            }
                            openCardModal($slot);
                        }
                    }
                }
            }
        });
    });
}

async function renderAlbum(album) {
    const $albumContainer = $(`
        <div class="public-album-item">
            <div class="public-album-header">
                <i class="fas fa-book-open"></i> ${album.title}
            </div>
            <div class="album-wrapper">
                <div id="album-${album.id}" class="album"></div>
            </div>
        </div>
    `);

    const $albumDiv = $albumContainer.find('.album');
    $('#albums-container').append($albumContainer);

    let { data: pages } = await _supabase
        .from('pages')
        .select('*')
        .eq('album_id', album.id)
        .order('page_index', { ascending: true });

    if (!pages) pages = [];

    const coverImg = album.cover_image_url;
    const coverColor = album.cover_color || '#1a1a1a';
    let pageCount = 1;

    if (coverImg) {
        $albumDiv.append(`<div class="page album-page cover-page" data-page-num="${pageCount}"><img src="${coverImg}"></div>`);
    } else {
        $albumDiv.append(`
            <div class="page album-page cover-page" data-page-num="${pageCount}">
                <div class="textured-cover" style="background-color: ${coverColor}">
                    <h2>${album.title}</h2>
                </div>
            </div>
        `);
    }

    for (const page of pages) {
        pageCount++;
        const $pageDiv = $(`<div class="page album-page" data-page-num="${pageCount}"></div>`);
        const $grid = $('<div class="grid-container"></div>');

        const { data: slots } = await _supabase
            .from('card_slots')
            .select('*')
            .eq('page_id', page.id)
            .order('slot_index', { ascending: true });

        for (let i = 0; i < 9; i++) {
            const slotData = slots ? slots.find(s => s.slot_index === i) : null;
            const $slot = $('<div class="card-slot"></div>');

            if (slotData) {
                // El nombre de la carta se almacena como atributo data-name para búsquedas (invisible en UI)
                // data-page almacena el número de página para navegación directa
                $slot.attr({
                    'data-name': slotData.name || '',
                    'data-page': pageCount,
                    'data-rarity': slotData.rarity || '',
                    'data-holo': slotData.holo_effect || '',
                    'data-mask': slotData.custom_mask_url || '',
                    'data-expansion': slotData.expansion || '',
                    'data-condition': slotData.condition || '',
                    'data-quantity': slotData.quantity || '',
                    'data-price': slotData.price || ''
                });
                if (slotData.image_url) {
                    const cardAlt = slotData.name || 'Carta';
                    $slot.append(`<img src="${slotData.image_url}" class="tcg-card" alt="${cardAlt}">`);
                    const $zoomBtn = $('<div class="zoom-btn"><i class="fas fa-search-plus"></i></div>');

                    // Prioridad para móvil: el listener global captura el touchstart.
                    // Aquí manejamos el clic final para abrir el modal.
                    $zoomBtn.on('click', function(e) {
                        e.stopPropagation();
                        openCardModal($(this).closest('.card-slot'));
                    });

                    $slot.append($zoomBtn);
                }
            }
            $grid.append($slot);
        }

        $pageDiv.append($grid).appendTo($albumDiv);
    }

    // Asegurarnos de que el álbum siempre termine con una contraportada independiente.
    // Para que la contraportada quede al final (lado izquierdo en double-page),
    // el total de páginas debe ser par.
    // Total = 1 (portada) + pages.length (internas) + [1 si hay relleno] + 1 (contraportada).
    // Si (1 + pages.length + 1) es impar (es decir, pages.length es impar), añadimos relleno.
    if (pages.length % 2 !== 0) {
        pageCount++;
        $albumDiv.append(`<div class="page album-page" data-page-num="${pageCount}"></div>`);
    }

    // Añadir contraportada siempre
    pageCount++;
    const backImg = album.back_image_url;
    const backColor = album.back_color || '#1a1a1a';

    if (backImg) {
        $albumDiv.append(`<div class="page album-page cover-page" data-page-num="${pageCount}"><img src="${backImg}"></div>`);
    } else {
        $albumDiv.append(`
            <div class="page album-page cover-page" data-page-num="${pageCount}">
                <div class="textured-cover" style="background-color: ${backColor}"></div>
            </div>
        `);
    }

    const $images = $albumDiv.find('img');
    let loadedCount = 0;
    let turnInitialized = false;

    const initTurn = () => {
        if (turnInitialized) return;
        turnInitialized = true;

        const isMobile = window.innerWidth <= 640;
        let width = $albumDiv.width() || 600;
        let height = $albumDiv.height() || 420;

        if (isMobile) {
            const containerWidth = $albumContainer.width();
            const availableWidth = Math.min(600, containerWidth - 10);
            width = availableWidth;
            height = Math.floor(width * (420 / 600));
        }

        $albumDiv.turn({
            width: width,
            height: height,
            autoCenter: true,
            gradients: true,
            acceleration: true,
            display: 'double',
            elevation: 50,
            duration: 1500, // Aumentado para mayor suavidad y evitar brusquedad
            // Ajustar cornerSize basado en el tamaño del álbum
            cornerSize: isMobile ? 80 : 100,
            when: {
                start: function(event, pageObject, corner) {
                    // Solo permitir el giro si es desde una esquina o disparado manualmente por búsqueda
                    if (!corner && !isManualPageTurn) {
                        event.preventDefault();
                        return;
                    }
                }
            }
        });
    };

    if ($images.length === 0) setTimeout(initTurn, 150);
    else {
        $images.on('load error', () => { if (++loadedCount >= $images.length) setTimeout(initTurn, 200); });
        setTimeout(initTurn, 1500);
    }

    // Si ya hay una búsqueda activa al terminar de cargar el álbum, aplicarla
    const currentQuery = $('#search-input').val().trim();
    if (currentQuery) {
        setTimeout(() => { filterContent(currentQuery); }, 2000);
    }
}
