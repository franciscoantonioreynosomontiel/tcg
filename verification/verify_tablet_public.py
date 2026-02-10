from playwright.sync_api import sync_playwright

def verify_tablet(page):
    # Kamvas Slot 10 is 1280x800
    page.set_viewport_size({"width": 800, "height": 1280}) # Portrait
    page.goto('http://localhost:8080/public.html?store=TCG%20Dual')
    page.wait_for_timeout(2000)
    page.screenshot(path='verification/tablet_portrait_public.png')

    page.set_viewport_size({"width": 1280, "height": 800}) # Landscape
    page.screenshot(path='verification/tablet_landscape_public.png')

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_tablet(page)
        finally:
            browser.close()
