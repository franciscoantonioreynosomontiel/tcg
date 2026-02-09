let currentAlbumId = null;
let currentDeckId = null;
let currentDeckCardId = null; // New for deck card editing
let currentSlotIndex = null;
let currentPageId = null;
let currentUser = null;
let editingType = 'slot'; // 'slot' or 'deck-card'

// Mask Editor State
let maskCanvas, maskCtx;
let isPainting = false;
let currentBrushSize = 10;
let currentTool = 'brush'; // 'brush' or 'eraser'
let maskHistory = [];
const MAX_HISTORY = 20;

let lastSearchId = 0;
let searchAbortController = null;
const tcgdex = typeof TCGdex !== 'undefined' ? new TCGdex('es') : null;

$(document).ready(function() {
    checkSession();

    // Authentication Actions
    $('#btn-login').click(function(e) {
        e.preventDefault();
        handleLogin();
    });
    $('#btn-logout').click(function(e) {
        e.preventDefault();
        handleLogout();
    });

    // Navigation
    $('#btn-dashboard').click(function(e) {
        e.preventDefault();
        showView('dashboard');
        loadAlbums();
    });

    $('#btn-decks').click(function(e) {
        e.preventDefault();
        showView('decks');
        loadDecks();
    });

    $('#btn-create-album').click(async function(e) {
        e.preventDefault();
        if (!currentUser) return;

        const { data, error } = await _supabase
            .from('albums')
            .insert([{ title: 'Nuevo Álbum', user_id: currentUser.id }])
            .select();

        if (error) {
            Swal.fire('Error', 'No se pudo crear el álbum', 'error');
            console.error(error);
        } else {
            loadAlbums();
        }
    });

    // Album Meta Save
    $('#btn-save-album-meta').click(async function(e) {
        e.preventDefault();
        const title = $('#input-album-title').val();
        const cover = $('#input-album-cover').val();
        const back = $('#input-album-back').val();
        const coverColor = $('#input-album-cover-color').val();
        const backColor = $('#input-album-back-color').val();
        const is_public = $('#input-album-public').is(':checked');

        let updateData = {
            title,
            cover_image_url: cover,
            back_image_url: back,
            cover_color: coverColor,
            back_color: backColor,
            is_public
        };
        let { error } = await _supabase
            .from('albums')
            .update(updateData)
            .eq('id', currentAlbumId);

        // Fallback for missing column
        if (error && (error.code === '42703' || (error.message && error.message.includes('is_public')))) {
            console.warn("is_public column missing, retrying update without it.");
            delete updateData.is_public;
            const retry = await _supabase
                .from('albums')
                .update(updateData)
                .eq('id', currentAlbumId);
            error = retry.error;
        }

        if (error) {
            Swal.fire('Error', 'No se pudieron guardar los cambios: ' + (error.message || ''), 'error');
            console.error(error);
        } else {
            Swal.fire({
                title: '¡Actualizado!',
                text: 'El álbum se ha actualizado correctamente',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
            loadAlbums();
            showView('dashboard');
        }
    });

    // Page Management
    $('#btn-add-page').click(async function(e) {
        e.preventDefault();
        const { data: pages } = await _supabase
            .from('pages')
            .select('page_index')
            .eq('album_id', currentAlbumId)
            .order('page_index', { ascending: false })
            .limit(1);

        const nextIndex = (pages && pages.length > 0) ? pages[0].page_index + 1 : 0;

        const { data, error } = await _supabase
            .from('pages')
            .insert([{ album_id: currentAlbumId, page_index: nextIndex }])
            .select();

        if (error) {
            Swal.fire('Error', 'No se pudo añadir la página', 'error');
            console.error(error);
        } else {
            loadAlbumPages(currentAlbumId, false);
        }
    });

    // Slot Management
    $(document).on('click', '.card-slot', function() {
        currentPageId = $(this).closest('.admin-page-item').data('id');
        currentSlotIndex = $(this).data('index');
        loadSlotData(currentPageId, currentSlotIndex);
    });

    $('#btn-save-slot').click(async function(e) {
        e.preventDefault();
        const cardData = {
            image_url: $('#slot-image-url').val(),
            name: $('#slot-name').val(),
            holo_effect: $('#slot-holo-effect').val(),
            custom_mask_url: $('#slot-custom-mask').val(),
            rarity: $('#slot-rarity').val(),
            expansion: $('#slot-expansion').val(),
            condition: $('#slot-condition').val(),
            quantity: $('#slot-quantity').val(),
            price: $('#slot-price').val()
        };

        let error;
        if (editingType === 'slot') {
            const slotData = { ...cardData, page_id: currentPageId, slot_index: currentSlotIndex };
            const result = await _supabase
                .from('card_slots')
                .upsert(slotData, { onConflict: 'page_id,slot_index' });
            error = result.error;
        } else {
            const result = await _supabase
                .from('deck_cards')
                .update(cardData)
                .eq('id', currentDeckCardId);
            error = result.error;
        }

        if (error) {
            Swal.fire('Error', 'No se pudo guardar la información de la carta: ' + (error.message || ''), 'error');
            console.error(error);
        } else {
            Swal.fire({
                title: 'Guardado',
                text: 'Carta actualizada',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
            $('#slot-modal').removeClass('active');
            if (editingType === 'slot') {
                loadAlbumPages(currentAlbumId);
            } else {
                loadDeckCards(currentDeckId);
            }
        }
    });

    $('#close-slot-modal').click(function() {
        $('#slot-modal').removeClass('active');
    });

    $('#slot-holo-effect').change(function() {
        if ($(this).val() === 'custom-texture') {
            $('#custom-mask-container').show();
        } else {
            $('#custom-mask-container').hide();
        }
    });

    // External Search Events
    $('#btn-search-card').click(async function(e) {
        e.preventDefault();
        const query = $('#search-card-input').val();
        const type = $('#search-card-type').val();

        if (!query) return;

        const searchId = ++lastSearchId;
        $(this).html('<i class="fas fa-spinner fa-spin"></i>');
        const results = await fetchCards(query, type);

        if (searchId !== lastSearchId) return;
        $(this).html('<i class="fas fa-search"></i>');

        displaySearchResults(results);
    });

    $('#search-card-input').keypress(function(e) {
        if (e.which == 13) {
            e.preventDefault();
            $('#btn-search-card').click();
        }
    });

    // Real-time search with debounce
    const handleRealTimeSearch = debounce(async function() {
        const query = $('#search-card-input').val();
        const type = $('#search-card-type').val();

        if (query.length < 3) {
            $('#search-results').hide();
            return;
        }

        const searchId = ++lastSearchId;
        $('#btn-search-card').html('<i class="fas fa-spinner fa-spin"></i>');

        // Mostrar estado de carga en el dropdown
        $('#search-results').html('<div style="padding: 15px; color: #888; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Buscando en ' + (type === 'yugioh' ? 'Yu-Gi-Oh!...' : 'Pokémon...') + '</div>').show();

        try {
            const results = await fetchCards(query, type);
            if (searchId !== lastSearchId) return;
            $('#btn-search-card').html('<i class="fas fa-search"></i>');
            displaySearchResults(results);
        } catch (error) {
            if (searchId === lastSearchId) {
                $('#btn-search-card').html('<i class="fas fa-search"></i>');
                if (error.name !== 'AbortError') {
                    $('#search-results').html('<div style="padding: 15px; color: #ff4d4d; text-align: center;">Error al buscar cartas</div>');
                }
            }
        }
    }, 800);

    $('#search-card-input').on('input', handleRealTimeSearch);

    // Close search results when clicking outside
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.search-container, .search-results-dropdown').length) {
            $('#search-results').hide();
        }
    });

    // --- Mask Editor Logic ---
    maskCanvas = document.getElementById('mask-canvas');
    if (maskCanvas) maskCtx = maskCanvas.getContext('2d');

    $('#btn-open-mask-editor').click(function(e) {
        e.preventDefault();
        const cardImgUrl = $('#slot-image-url').val();
        if (!cardImgUrl) {
            Swal.fire('Atención', 'Primero debes poner la URL de la imagen de la carta para usar de referencia.', 'warning');
            return;
        }

        // Set card as background
        $('#mask-canvas-wrapper').css('background-image', `url(${cardImgUrl})`);

        // Initialize canvas
        initMaskCanvas();

        $('#mask-editor-overlay').addClass('active');
    });

    $('#close-mask-editor').click(function() {
        $('#mask-editor-overlay').removeClass('active');
    });

    $('#brush-size').on('input', function() {
        currentBrushSize = $(this).val();
        $('#brush-size-val').text(currentBrushSize);
    });

    $('#tool-brush').click(function() {
        currentTool = 'brush';
        $('.editor-controls .btn-secondary').removeClass('active');
        $(this).addClass('active');
    });

    $('#tool-eraser').click(function() {
        currentTool = 'eraser';
        $('.editor-controls .btn-secondary').removeClass('active');
        $(this).addClass('active');
    });

    $('#btn-clear-mask').click(function() {
        Swal.fire({
            title: '¿Limpiar todo?',
            text: "Se borrará todo el dibujo de la máscara.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, limpiar'
        }).then((result) => {
            if (result.isConfirmed) {
                saveMaskHistory();
                maskCtx.fillStyle = 'black';
                maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
            }
        });
    });

    $('#btn-undo-mask').click(function() {
        if (maskHistory.length > 0) {
            const lastState = maskHistory.pop();
            const img = new Image();
            img.onload = function() {
                maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                maskCtx.drawImage(img, 0, 0);
            };
            img.src = lastState;
        }
    });

    $('#btn-save-mask').click(function() {
        // Save canvas as base64
        const dataUrl = maskCanvas.toDataURL('image/png');
        $('#slot-custom-mask').val(dataUrl);
        $('#mask-editor-overlay').removeClass('active');
        Swal.fire('Guardado', 'La máscara se ha generado correctamente. No olvides guardar la carta para aplicar los cambios.', 'success');
    });

    // Canvas Events
    $(maskCanvas).on('mousedown touchstart', function(e) {
        isPainting = true;
        saveMaskHistory();
        draw(e);
    });

    $(window).on('mousemove touchmove', function(e) {
        if (isPainting) draw(e);
    });

    $(window).on('mouseup touchend', function() {
        isPainting = false;
        maskCtx.beginPath();
    });

    function initMaskCanvas() {
        const currentMask = $('#slot-custom-mask').val();

        // Fill black background first
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        if (currentMask) {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = function() {
                maskCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);
            };
            img.onerror = function() {
                console.warn("No se pudo cargar la máscara previa en el lienzo (puede ser por CORS).");
            };
            img.src = currentMask;
        }

        maskHistory = [];
    }

    function saveMaskHistory() {
        if (maskHistory.length >= MAX_HISTORY) maskHistory.shift();
        maskHistory.push(maskCanvas.toDataURL());
    }

    function draw(e) {
        if (!isPainting) return;

        const rect = maskCanvas.getBoundingClientRect();
        let x, y;

        if (e.type.includes('touch')) {
            const touch = e.originalEvent.touches[0] || e.originalEvent.changedTouches[0];
            x = touch.clientX - rect.left;
            y = touch.clientY - rect.top;
            e.preventDefault();
        } else {
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }

        // Scale coordinates if canvas display size is different from actual size
        x = x * (maskCanvas.width / rect.width);
        y = y * (maskCanvas.height / rect.height);

        maskCtx.lineWidth = currentBrushSize;
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = currentTool === 'brush' ? 'white' : 'black';

        maskCtx.lineTo(x, y);
        maskCtx.stroke();
        maskCtx.beginPath();
        maskCtx.moveTo(x, y);
    }

    // Deck Management Actions
    $('#btn-create-deck').click(async function(e) {
        e.preventDefault();
        if (!currentUser) return;

        const { data, error } = await _supabase
            .from('decks')
            .insert([{ name: 'Nuevo Deck', user_id: currentUser.id }])
            .select();

        if (error) {
            Swal.fire('Error', 'No se pudo crear el deck', 'error');
        } else {
            loadDecks();
        }
    });

    $('#btn-save-deck-meta').click(async function(e) {
        e.preventDefault();
        const name = $('#input-deck-name').val();
        const is_public = $('#input-deck-public').is(':checked');

        let updateData = { name, is_public };
        let { error } = await _supabase
            .from('decks')
            .update(updateData)
            .eq('id', currentDeckId);

        // Fallback for missing column
        if (error && (error.code === '42703' || (error.message && error.message.includes('is_public')))) {
            console.warn("is_public column missing, retrying update without it.");
            delete updateData.is_public;
            const retry = await _supabase
                .from('decks')
                .update(updateData)
                .eq('id', currentDeckId);
            error = retry.error;
        }

        if (error) {
            Swal.fire('Error', 'No se pudo actualizar el deck: ' + (error.message || ''), 'error');
            console.error(error);
        } else {
            Swal.fire('¡Éxito!', 'Nombre del deck actualizado', 'success');
            loadDecks();
        }
    });

    $('#btn-add-deck-card').click(async function(e) {
        e.preventDefault();
        const { value: url } = await Swal.fire({
            title: 'Añadir imagen al deck',
            input: 'url',
            inputLabel: 'URL de la imagen',
            inputPlaceholder: 'https://...',
            showCancelButton: true
        });

        if (url) {
            const { error } = await _supabase
                .from('deck_cards')
                .insert([{ deck_id: currentDeckId, image_url: url }]);

            if (error) {
                Swal.fire('Error', 'No se pudo añadir la imagen', 'error');
            } else {
                loadDeckCards(currentDeckId);
            }
        }
    });

    // Toggle Public/Private from list
    $(document).on('change', '.toggle-public', async function() {
        const id = $(this).data('id');
        const type = $(this).data('type');
        const isChecked = $(this).is(':checked');
        const $label = $(this).parent().next();

        $label.text(isChecked ? 'Público' : 'Privado');

        const { error } = await _supabase
            .from(type)
            .update({ is_public: isChecked })
            .eq('id', id);

        if (error) {
            if (error.code === '42703' || (error.message && error.message.includes('is_public'))) {
                Swal.fire('Error de Base de Datos', 'La columna "is_public" no existe. Debes ejecutar el script SQL "supabase_setup.sql" en tu panel de Supabase.', 'error');
            } else {
                Swal.fire('Error', 'No se pudo actualizar la visibilidad: ' + (error.message || ''), 'error');
                console.error(error);
            }
            // Revert UI if error
            $(this).prop('checked', !isChecked);
            $label.text(!isChecked ? 'Público' : 'Privado');
        }
    });
});

// Auth Functions
function checkSession() {
    const session = localStorage.getItem('tcg_session');
    if (session) {
        currentUser = JSON.parse(session);
        showAuthenticatedContent();
    } else {
        showLoginView();
    }
}

async function handleLogin() {
    const username = $('#login-username').val();
    const password = $('#login-password').val();

    if (!username || !password) {
        Swal.fire('Atención', 'Por favor, completa todos los campos', 'warning');
        return;
    }

    const { data, error } = await _supabase
        .from('usuarios')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();

    if (error || !data) {
        Swal.fire('Error', 'Usuario o contraseña incorrectos', 'error');
    } else {
        currentUser = data;
        localStorage.setItem('tcg_session', JSON.stringify(data));
        showAuthenticatedContent();
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('tcg_session');
    location.reload();
}

function showLoginView() {
    $('body').removeClass('public-body');
    $('#login-modal').addClass('active');
    $('#authenticated-content').hide();
}

function showAuthenticatedContent() {
    $('body').addClass('public-body');
    $('#login-modal').removeClass('active');
    $('#authenticated-content').show();
    $('#welcome-message').text(`Álbumes de ${currentUser.username}`);

    // Show user panel only if admin
    if (currentUser.role === 'admin') {
        $('#btn-users-panel').show();
    } else {
        $('#btn-users-panel').hide();
    }

    // Generate public store link
    const publicUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', 'public.html')}?store=${encodeURIComponent(currentUser.store_name)}`;

    const linkHtml = `
        <div class="share-card">
            <div class="share-info">
                <i class="fas fa-link"></i>
                <span>Enlace de tu tienda:</span>
                <input type="text" id="public-link-input" value="${publicUrl}" readonly>
            </div>
            <button onclick="copyPublicLink()" class="btn btn-copy">
                <i class="fas fa-copy"></i> Copiar
            </button>
            <a href="${publicUrl}" target="_blank" class="btn btn-visit">
                <i class="fas fa-external-link-alt"></i> Visitar
            </a>
        </div>
    `;
    $('#store-link-container').html(linkHtml);

    showView('dashboard');
    loadAlbums();
}

function copyPublicLink() {
    const copyText = document.getElementById("public-link-input");
    copyText.select();
    copyText.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(copyText.value);

    const btn = document.querySelector('.btn-copy');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> ¡Copiado!';
    btn.classList.add('btn-success');

    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('btn-success');
    }, 2000);
}

// Data Functions
// Deck Functions
async function loadDecks() {
    $('#deck-list').html('<div class="loading">Cargando decks...</div>');

    const { data: decks, error } = await _supabase
        .from('decks')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('id', { ascending: true });

    if (error) {
        $('#deck-list').html('<div class="error">Error al cargar decks.</div>');
        return;
    }

    if (decks.length === 0) {
        $('#deck-list').html('<div class="empty">No tienes decks. Crea uno para empezar.</div>');
        return;
    }

    const $tempContainer = $('<div></div>');
    decks.forEach(deck => {
        const isPublic = deck.is_public !== false;
        const publicSwitch = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <label class="switch">
                    <input type="checkbox" class="toggle-public" data-id="${deck.id}" data-type="decks" ${isPublic ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
                <span style="font-size: 10px; color: #aaa;">${isPublic ? 'Público' : 'Privado'}</span>
            </div>
        `;

        const $card = $(`
            <div class="album-card">
                <div class="deck-preview-icon"><i class="fas fa-layer-group fa-3x"></i></div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <h3 style="margin:0;">${deck.name}</h3>
                </div>
                <div style="margin-top: 5px;">
                    ${publicSwitch}
                </div>
                <div style="display:flex; gap:10px; margin-top:auto;">
                    <button class="btn btn-edit-deck" data-id="${deck.id}">Editar</button>
                    <button class="btn btn-danger btn-delete-deck" data-id="${deck.id}">Eliminar</button>
                </div>
            </div>
        `);

        $card.find('.btn-edit-deck').click((e) => { e.preventDefault(); editDeck(deck); });
        $card.find('.btn-delete-deck').click((e) => { e.preventDefault(); deleteDeck(deck.id); });

        $tempContainer.append($card);
    });
    $('#deck-list').html($tempContainer.contents());
}

async function editDeck(deck) {
    // Re-fetch para evitar datos obsoletos del cierre
    const { data: latestDeck } = await _supabase
        .from('decks')
        .select('*')
        .eq('id', deck.id)
        .single();

    const target = latestDeck || deck;

    currentDeckId = target.id;
    $('#deck-editor-title').text(`Editando: ${target.name}`);
    $('#input-deck-name').val(target.name);
    $('#input-deck-public').prop('checked', target.is_public !== false);

    showView('deck-editor');
    loadDeckCards(target.id);
}

async function deleteDeck(id) {
    const result = await Swal.fire({
        title: '¿Eliminar deck?',
        text: "Se eliminará el deck y todas sus cartas",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff4757',
        confirmButtonText: 'Sí, eliminar'
    });

    if (result.isConfirmed) {
        const { error } = await _supabase.from('decks').delete().eq('id', id);
        if (error) {
            Swal.fire('Error', 'No se pudo eliminar el deck', 'error');
        } else {
            loadDecks();
        }
    }
}

async function loadDeckCards(deckId) {
    $('#deck-card-list').html('<div class="loading">Cargando imágenes...</div>');

    const { data: cards, error } = await _supabase
        .from('deck_cards')
        .select('*')
        .eq('deck_id', deckId)
        .order('id', { ascending: true });

    if (error) {
        $('#deck-card-list').html('<div class="error">Error al cargar imágenes.</div>');
        return;
    }

    const $tempContainer = $('<div></div>');
    cards.forEach(card => {
        const $cardItem = $(`
            <div class="album-card deck-card-item" style="cursor:pointer;">
                <img src="${card.image_url}" style="width:100%; height:150px; object-fit:contain;">
                <div style="font-size: 12px; margin-top: 5px; color: #aaa; text-align: center;">${card.name || 'Sin nombre'}</div>
                <button class="btn btn-danger btn-sm btn-delete-deck-card" style="margin-top:10px;">Eliminar</button>
            </div>
        `);

        $cardItem.click((e) => {
            e.preventDefault();
            if ($(e.target).hasClass('btn-delete-deck-card')) return;
            editDeckCard(card);
        });

        $cardItem.find('.btn-delete-deck-card').click(async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const res = await Swal.fire({
                title: '¿Eliminar carta?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí'
            });
            if (res.isConfirmed) {
                await _supabase.from('deck_cards').delete().eq('id', card.id);
                loadDeckCards(deckId);
            }
        });

        $tempContainer.append($cardItem);
    });
    $('#deck-card-list').html($tempContainer.contents());
}

function editDeckCard(card) {
    editingType = 'deck-card';
    currentDeckCardId = card.id;

    resetSearch();
    $('#slot-image-url').val(card.image_url || '');
    $('#slot-name').val(card.name || '');
    $('#slot-holo-effect').val(card.holo_effect || '');
    $('#slot-custom-mask').val(card.custom_mask_url || '');

    if (card.holo_effect === 'custom-texture') {
        $('#custom-mask-container').show();
    } else {
        $('#custom-mask-container').hide();
    }

    $('#slot-rarity').val(card.rarity || '');
    $('#slot-expansion').val(card.expansion || '');
    $('#slot-condition').val(card.condition || '');
    $('#slot-quantity').val(card.quantity || 1);
    $('#slot-price').val(card.price || '');

    $('#slot-modal').addClass('active');
}

async function loadAlbums() {
    $('#album-list').html('<div class="loading">Cargando álbumes...</div>');

    const { data: albums, error } = await _supabase
        .from('albums')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('id', { ascending: true });

    if (error) {
        $('#album-list').html('<div class="error">Error al cargar álbumes.</div>');
        return;
    }

    if (albums.length === 0) {
        $('#album-list').html('<div class="empty">No tienes álbumes. Crea uno para empezar.</div>');
        return;
    }

    const $tempContainer = $('<div></div>');
    albums.forEach(album => {
        const cover = album.cover_image_url || 'https://via.placeholder.com/300x150?text=Sin+Portada';
        const isPublic = album.is_public !== false;
        const publicSwitch = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <label class="switch">
                    <input type="checkbox" class="toggle-public" data-id="${album.id}" data-type="albums" ${isPublic ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
                <span style="font-size: 10px; color: #aaa;">${isPublic ? 'Público' : 'Privado'}</span>
            </div>
        `;

        const $card = $(`
            <div class="album-card">
                <img src="${cover}" alt="${album.title}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                    <h3 style="margin:0;">${album.title}</h3>
                </div>
                <div style="margin-top: 5px;">
                    ${publicSwitch}
                </div>
                <div style="display:flex; gap:10px; margin-top:auto;">
                    <button class="btn btn-edit-album" data-id="${album.id}">Editar</button>
                    <button class="btn btn-danger btn-delete-album" data-id="${album.id}">Eliminar</button>
                </div>
            </div>
        `);

        $card.find('.btn-edit-album').click((e) => { e.preventDefault(); editAlbum(album); });
        $card.find('.btn-delete-album').click((e) => { e.preventDefault(); deleteAlbum(album.id); });

        $tempContainer.append($card);
    });
    $('#album-list').html($tempContainer.contents());
}

function showView(view) {
    $('.admin-section').hide();
    $(`#view-${view}`).show();
}

async function editAlbum(album) {
    // Re-fetch para evitar datos obsoletos del cierre
    const { data: latestAlbum } = await _supabase
        .from('albums')
        .select('*')
        .eq('id', album.id)
        .single();

    const target = latestAlbum || album;

    currentAlbumId = target.id;
    $('#editor-title').text(`Editando: ${target.title}`);
    $('#input-album-title').val(target.title);
    $('#input-album-cover').val(target.cover_image_url || '');
    $('#input-album-back').val(target.back_image_url || '');
    $('#input-album-cover-color').val(target.cover_color || '#1a1a1a');
    $('#input-album-back-color').val(target.back_color || '#1a1a1a');
    $('#input-album-public').prop('checked', target.is_public !== false);
    
    showView('editor');
    loadAlbumPages(target.id);
}

async function deleteAlbum(id) {
    const result = await Swal.fire({
        title: '¿Estás seguro?',
        text: "Se eliminará el álbum y todo su contenido permanentemente",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff4757',
        cancelButtonColor: '#333',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        const { error } = await _supabase.from('albums').delete().eq('id', id);
        if (error) {
            Swal.fire('Error', 'No se pudo eliminar el álbum', 'error');
        } else {
            Swal.fire('Eliminado', 'El álbum ha sido borrado', 'success');
            loadAlbums();
        }
    }
}

async function loadAlbumPages(albumId, isInitial = true) {
    if (isInitial) {
        $('#page-list').html('<div class="loading">Cargando páginas...</div>');
    }

    const { data: pages, error } = await _supabase
        .from('pages')
        .select('*')
        .eq('album_id', albumId)
        .order('page_index', { ascending: true });

    if (error) {
        $('#page-list').html('<div class="error">Error al cargar páginas.</div>');
        return;
    }

    // Obtener todos los slots de todas las páginas en una sola consulta
    const pageIds = pages.map(p => p.id);
    let allSlots = [];
    if (pageIds.length > 0) {
        const { data: slotsData } = await _supabase
            .from('card_slots')
            .select('*')
            .in('page_id', pageIds);
        allSlots = slotsData || [];
    }

    const $tempContainer = $('<div></div>');
    
    for (const page of pages) {
        const $pageItem = $(`
            <div class="admin-page-item" data-id="${page.id}">
                <h3>
                    Página ${page.page_index + 1}
                    <button class="btn btn-danger btn-sm btn-delete-page" data-id="${page.id}">Eliminar Página</button>
                </h3>
                <div class="grid-container admin-grid-preview">
                    <!-- 9 Slots -->
                </div>
            </div>
        `);

        $pageItem.find('.btn-delete-page').click((e) => {
            e.preventDefault();
            deletePage(page.id);
        });

        const $grid = $pageItem.find('.grid-container');
        const pageSlots = allSlots.filter(s => s.page_id === page.id);

        for (let i = 0; i < 9; i++) {
            const slotData = pageSlots.find(s => s.slot_index === i);
            const $slot = $(`<div class="card-slot" data-index="${i}"></div>`);
            if (slotData && slotData.image_url) {
                $slot.append(`<img src="${slotData.image_url}" class="tcg-card">`);
            } else {
                $slot.append('<div style="color:#444; font-size:10px; text-align:center; padding-top:10px;">Vacío</div>');
            }
            $grid.append($slot);
        }

        $tempContainer.append($pageItem);
    }

    $('#page-list').html($tempContainer.contents());
}

async function deletePage(id) {
    const result = await Swal.fire({
        title: '¿Eliminar página?',
        text: "Esta acción no se puede deshacer",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff4757',
        cancelButtonColor: '#333',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        const { error } = await _supabase.from('pages').delete().eq('id', id);
        if (error) {
            Swal.fire('Error', 'No se pudo eliminar la página', 'error');
        } else {
            Swal.fire('Eliminada', 'La página ha sido borrada', 'success');
            loadAlbumPages(currentAlbumId, false);
        }
    }
}

function resetSearch() {
    $('#search-results').hide();
    $('#search-card-input').val('');
}

async function loadSlotData(pageId, slotIndex) {
    editingType = 'slot';
    resetSearch();
    const { data, error } = await _supabase
        .from('card_slots')
        .select('*')
        .eq('page_id', pageId)
        .eq('slot_index', slotIndex)
        .single();

    $('#slot-image-url').val('');
    $('#slot-name').val('');
    $('#slot-holo-effect').val('');
    $('#slot-custom-mask').val('');
    $('#slot-rarity').val('');
    $('#slot-expansion').val('');
    $('#slot-condition').val('');
    $('#slot-quantity').val('');
    $('#slot-price').val('');

    if (data) {
        $('#slot-image-url').val(data.image_url || '');
        $('#slot-name').val(data.name || '');
        $('#slot-holo-effect').val(data.holo_effect || '');
        $('#slot-custom-mask').val(data.custom_mask_url || '');

        if (data.holo_effect === 'custom-texture') {
            $('#custom-mask-container').show();
        } else {
            $('#custom-mask-container').hide();
        }

        $('#slot-rarity').val(data.rarity || '');
        $('#slot-expansion').val(data.expansion || '');
        $('#slot-condition').val(data.condition || '');
        $('#slot-quantity').val(data.quantity || '');
        $('#slot-price').val(data.price || '');
    }

    $('#slot-modal').addClass('active');
}

// --- External Search Logic ---

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

async function fetchCards(query, type) {
    if (!query) return [];

    if (searchAbortController) {
        searchAbortController.abort();
    }
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;
    const timeoutId = setTimeout(() => searchAbortController.abort(), 15000); // Aumentado a 15s

    try {
        if (type === 'pokemon') {
            // Usar la API REST de TCGdex directamente para búsqueda filtrada
            const response = await fetch(`https://api.tcgdex.net/v2/es/cards?name=${encodeURIComponent(query)}`, { signal: signal });
            if (!response.ok) return [];
            const results = await response.json();

            clearTimeout(timeoutId);
            if (!Array.isArray(results)) return [];

            // Limitar resultados para fluidez
            return results.slice(0, 20).map(card => ({
                id: card.id,
                name: card.name,
                imageUrlSmall: card.image ? `${card.image}/low.webp` : '',
                imageUrlLarge: card.image ? `${card.image}/high.png` : '',
                details: `ID: ${card.localId}`,
                set: '', // Se cargará al seleccionar
                rarity: '',
                type: 'pokemon'
            }));
        } else if (type === 'yugioh') {
            const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}`, { signal: signal });
            clearTimeout(timeoutId);
            const json = await response.json();
            if (!json.data) return [];

            const results = [];
            const seen = new Set();

            for (const card of json.data) {
                for (const img of card.card_images) {
                    if (card.card_sets && card.card_sets.length > 0) {
                        for (const set of card.card_sets) {
                            const key = `${card.name}|${set.set_name}|${set.set_rarity}|${img.image_url}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                results.push({
                                    name: card.name,
                                    imageUrlSmall: img.image_url_small,
                                    imageUrlLarge: img.image_url,
                                    details: card.type,
                                    set: set.set_name,
                                    rarity: set.set_rarity,
                                    type: 'yugioh'
                                });
                            }
                            if (results.length >= 100) break;
                        }
                    } else {
                        const key = `${card.name}|NoSet|Common|${img.image_url}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            results.push({
                                name: card.name,
                                imageUrlSmall: img.image_url_small,
                                imageUrlLarge: img.image_url,
                                details: card.type,
                                set: 'No Set Info',
                                rarity: 'Common',
                                type: 'yugioh'
                            });
                        }
                    }
                    if (results.length >= 100) break;
                }
                if (results.length >= 100) break;
            }
            return results;
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Fetch de búsqueda abortado');
        } else {
            console.error("Error fetching cards:", error);
        }
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
    return [];
}

function displaySearchResults(results) {
    const $container = $('#search-results');
    $container.empty();

    if (results.length === 0) {
        $container.html('<div style="padding: 15px; color: #666; font-size: 13px;">No se encontraron resultados.</div>');
        $container.show();
        return;
    }

    results.forEach(card => {
        const $item = $(`
            <div class="search-result-item">
                <img src="${card.imageUrlSmall}" alt="${card.name}">
                <div class="search-result-info">
                    <span class="search-result-name">${card.name}</span>
                    <span class="search-result-details">${card.details}</span>
                    <span class="search-result-set">${card.set} ${card.rarity ? '('+card.rarity+')' : ''}</span>
                </div>
            </div>
        `);

        $item.click(() => selectCard(card));
        $container.append($item);
    });

    $container.show();
}

async function selectCard(card) {
    if (card.type === 'pokemon' && card.id && tcgdex) {
        // Mostrar indicador de carga en los inputs mientras se obtienen detalles
        $('#slot-name').val('Cargando detalles...');

        try {
            const fullCard = await tcgdex.card.get(card.id);
            if (fullCard) {
                card.imageUrlLarge = fullCard.getImageURL('high', 'png');
                card.rarity = fullCard.rarity || '';
                card.set = fullCard.set ? fullCard.set.name : '';
            }
        } catch (e) {
            console.error("Error fetching full pokemon card data:", e);
        }
    }

    $('#slot-image-url').val(card.imageUrlLarge);
    $('#slot-name').val(card.name);
    $('#slot-rarity').val(card.rarity);
    $('#slot-expansion').val(card.set);

    $('#search-results').hide();
    $('#search-card-input').val('');

    Swal.fire({
        title: '¡Cargado!',
        text: 'Información de la carta cargada en el formulario.',
        icon: 'success',
        timer: 1500,
        showConfirmButton: false
    });
}
