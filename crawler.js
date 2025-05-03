const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;

async function scrapeAfricaCategory(africaUrl) {
  try {
    // Fetch the Africa category page
    const response = await axios.get(africaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Load HTML into cheerio
    const $ = cheerio.load(response.data);

    // Array to store articles
    const articles = [];

    // Select article elements (adjust selectors based on actual HTML structure)
    $('article, div.post, .post, .article').each((index, element) => {
      // Extract title and link
      const titleElement = $(element).find('h2, h3');
      const title = titleElement.text().trim();
      const linkElement = titleElement.find('a').length ? titleElement.find('a') : $(element).find('a').first();
      let link = linkElement.attr('href');
      link = link && link.startsWith('http') ? link : `https://www.digitalworldwidenews.com${link || ''}`;

      // Extract image
      const image = $(element).find('img').attr('src');
      const imageUrl = image && image.startsWith('http') ? image : image ? `https://www.digitalworldwidenews.com${image}` : null;

      // Extract content text (preview text if available)
      const contentElement = $(element).find('p').not('.author, .date');
      const contentText = contentElement.text().trim() || null;

      // Extract author and date (common class names, adjust as needed)
      const author = $(element).find('.author, [class*="author"], [class*="byline"]').text().replace(/By|Author:/i, '').trim() || null;
      const date = $(element).find('.date, [class*="date"], time').text().trim() || null;

      if (title && link) {
        articles.push({
          title,
          link,
          image: imageUrl,
          content: contentText,
          author,
          date
        });
      }
    });

    return articles;
  } catch (error) {
    console.error(`Error scraping Africa category:`, error.message);
    return [];
  }
}

async function crawlAfricaCategory() {
  try {
    // Fetch the homepage to get the Africa category URL
    const response = await axios.get('https://www.digitalworldwidenews.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Load HTML into cheerio
    const $ = cheerio.load(response.data);

    // Find the Africa category link
    let africaUrl = null;
    $('nav a').each((index, element) => {
      const category = $(element).text().trim();
      if (category === 'Africa') {
        let link = $(element).attr('href');
        africaUrl = link.startsWith('http') ? link : `https://www.digitalworldwidenews.com${link}`;
      }
    });

    if (!africaUrl) {
      throw new Error('Africa category URL not found');
    }

    // Scrape articles from the Africa category
    const articles = await scrapeAfricaCategory(africaUrl);

    // Save the data to a JSON file
    const result = { category: 'Africa', articles };
    await fs.writeFile('africa_articles.json', JSON.stringify(result, null, 2));
    console.log(`Extracted ${articles.length} articles from Africa category and saved to africa_articles.json`);

  } catch (error) {
    console.error('Error during crawling:', error.message);
  }
}

// Run the crawler
crawlAfricaCategory();