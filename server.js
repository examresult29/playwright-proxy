const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Allow cross-origin requests (for WordPress)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Launch browser once
let browser;
(async () => {
  try {
    browser = await chromium.launch({
      headless: true
    });
    console.log('✅ Playwright browser launched');
  } catch (err) {
    console.error('❌ Failed to launch browser:', err.message);
  }
})();

// Helper: Map exam/year to URLs
function getUrls(exam, year) {
  const base = 'http://results.nu.ac.bd';

  if (exam === 'honours') {
    const pages = {
      '1': 'first_year_result',
      '2': 'second_year_result',
      '3': 'third_year_result',
      '4': 'fourth_year_result',
      'consolidated': 'final_year_result'
    };
    const page = pages[year];
    if (!page) return null;
    return {
      form: `${base}/honours/${page}.php`,
      action: `${base}/honours/${page}_show.php`
    };
  }

  return null;
}

// API Route: POST /fetch
app.post('/fetch', async (req, res) => {
  let page = null;

  try {
    const { exam, year, roll, reg, examYear } = req.body;

    // Validate input
    if (!exam || !year || !reg || !examYear) {
      return res.status(400).send('Missing required fields');
    }

    const urls = getUrls(exam, year);
    if (!urls) {
      return res.status(400).send('Invalid exam or year');
    }

    if (!browser) {
      return res.status(500).send('Browser not ready');
    }

    // Open new context
    const context = await browser.newContext();
    page = await context.newPage();

    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Step 1: Go to form page
    console.log(`Visiting: ${urls.form}`);
    await page.goto(urls.form, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Step 2: Extract tokens (csrf_token, letters_code)
    const tokens = await page.evaluate(() => {
      const csrf = document.querySelector('input[name="csrf_token"]');
      const letters = document.querySelector('input[name="letters_code"]');
      return {
        csrf_token: csrf ? csrf.value : null,
        letters_code: letters ? letters.value : null
      };
    });

    if (!tokens.csrf_token || !tokens.letters_code) {
      await page.close();
      return res.status(500).send('❌ Failed to extract security tokens');
    }

    // Step 3: Submit form via JavaScript
    const resultHtml = await page.evaluate(async ({ urls, roll, reg, examYear, tokens }) => {
      // Create form
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = urls.action;

      // Add inputs
      const inputs = {
        roll_number: roll,
        reg_no: reg,
        exam_year: examYear,
        csrf_token: tokens.csrf_token,
        letters_code: tokens.letters_code
      };

      for (const [name, value] of Object.entries(inputs)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);

      // Submit and get response
      const data = new FormData(form);
      const response = await fetch(form.action, {
        method: 'POST',
        body: data
      });
      return await response.text();
    }, { urls, roll, reg, examYear, tokens });

    // Step 4: Send result back
    res.setHeader('Content-Type', 'text/html');
    res.send(resultHtml);

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(`<h3>🚨 Proxy Error</h3><p>${error.message}</p>`);
  } finally {
    // Close page if created
    if (page) {
      await page.close();
    }
  }
});

// Test route
app.get('/', (req, res) => {
  res.send(`
    <h2>🎓 NU Result Playwright Proxy</h2>
    <p>Running for educational purposes.</p>
    <code>POST /fetch with exam, year, roll, reg, examYear</code>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`👉 Your app will be live at: https://your-name.onrender.com`);
});