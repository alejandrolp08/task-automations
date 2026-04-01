const WAY_SELECTORS = {
  common: {
    cookieAcceptButton: 'button:has-text("Accept")',
    cookiePreferencesButton: 'button:has-text("Preferences")',
  },
  login: {
    emailInput:
      'input[type="email"], input[name="email"], input[placeholder*="Email"], input[placeholder*="email"]',
    passwordInput:
      'input[type="password"], input[name="password"], input[placeholder*="Password"], input[placeholder*="password"]',
    submitButton:
      'button:has-text("Login"), button:has-text("Log In"), button:has-text("Sign in"), button[type="submit"]',
  },
  home: {
    widgetRoot: 'text=Location',
    modeAirportButton: 'button:has-text("Airport"), [role="button"]:has-text("Airport")',
    modeHourlyDailyButton: 'button:has-text("Hourly/Daily"), [role="button"]:has-text("Hourly/Daily")',
    locationSection: 'text=Location',
    locationInput:
      'input[placeholder*="park"], input[placeholder*="Search"], input[type="search"], input[role="combobox"]',
    locationSuggestion: '[role="option"], li, .pac-item, [data-testid*="suggestion"]',
    checkInSection: 'text=Check-in',
    checkoutSection: 'text=Select date & time',
    calendarRoot: '.clboxx',
    calendarPrevButton: '.picker-navigate-left-arrow, button:has-text("<"), button[aria-label*="previous"], text=/^<$/',
    calendarNextButton: '.picker-navigate-right-arrow, button:has-text(">"), button[aria-label*="next"], text=/^>$/',
    datePickerDayButton: 'button, [role="button"]',
    timeOption: 'text=/^\\d{2}:\\d{2}\\s(?:AM|PM)$/',
    searchButton: 'button[aria-label="search"], button[aria-label*="search" i], button:has-text("Search")',
  },
  results: {
    reserveNowButton: 'button:has-text("Reserve now")',
  },
  checkout: {
    membershipSkipButton:
      'button:has-text("No thanks"), button:has-text("Skip"), button:has-text("Continue without"), text=/No, I don[’\']t want discounts\\s*&\\s*benefits/i',
    proceedToCheckoutButton:
      'button:text-is("Proceed to Checkout"), a:text-is("Proceed to Checkout")',
    finalCheckoutButton: 'button:text-is("Checkout")',
    orderConfirmedSkipButton: 'button:has-text("Skip"), a:has-text("Skip"), text=/^Skip$/i',
    orderConfirmedContinueButton: 'button:has-text("Continue"), a:has-text("Continue"), text=/^Continue$/i',
    vehicleDetailsSection: 'text=/Vehicle Details/i',
    savedVehiclesSection: 'text=/Saved Vehicles/i',
    licensePlateRequiredModal: 'text=/License plate is mandatory to book/i',
    priceSummary: 'text=/\\$\\d+(\\.\\d{2})?/',
  },
  orders: {
    orderRow: '[data-testid*="order"], .order-item, .order-card',
    reservationIdText: 'text=/[A-Z]{3}\\d{8}/',
    printButton: 'button:has-text("Print"), a:has-text("Print")',
  },
};

module.exports = { WAY_SELECTORS };
