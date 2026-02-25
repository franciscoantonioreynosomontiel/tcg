from playwright.sync_api import sync_playwright
import time
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        path = os.path.abspath("docs/public.html")
        page.goto(f"file://{path}")

        # We need to wait for scripts to load
        page.wait_for_selector("body")

        # Test amazing-rare
        page.evaluate('''() => {
            const slot = $('<div data-name="Test" data-holo="amazing-rare"><img src="test.png"></div>');
            openCardModal(slot);
        }''')

        time.sleep(1)

        structure = page.evaluate('''() => {
            const card3d = document.querySelector('#card-3d');
            return {
                classes: card3d.className,
                rarity: card3d.getAttribute('data-rarity'),
                hasShine: !!document.querySelector('.card__shine'),
                hasGlare: !!document.querySelector('.card__glare')
            };
        }''')
        print(f"amazing-rare: {structure}")

        # Test old effect: super-rare
        page.evaluate('''() => {
            const slot = $('<div data-name="Old" data-holo="super-rare"><img src="test.png"></div>');
            openCardModal(slot);
        }''')

        time.sleep(1)

        structure_old = page.evaluate('''() => {
            const card3d = document.querySelector('#card-3d');
            const cardContainer = document.querySelector('#card-3d-container');
            return {
                containerClasses: cardContainer.className,
                hasShine: !!document.querySelector('.card__shine'),
                hasGlare: !!document.querySelector('.card__glare'),
                hasHoloLayer: !!document.querySelector('.holo-layer')
            };
        }''')
        print(f"super-rare (old): {structure_old}")

        browser.close()

if __name__ == "__main__":
    run()
