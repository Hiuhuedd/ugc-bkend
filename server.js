const express = require('express');
const snoowrap = require('snoowrap');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cors = require('cors');
const { ApifyClient } = require('apify-client');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(cors({
    origin: ['http://localhost:3000', 'https://reddit-user-gen-content.netlify.app'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

// Reddit API setup
const r = new snoowrap({
    userAgent: 'ugc-app/0.1 by your-username',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
});

// Google Search API setup
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// Browserless setup
const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;

// ApifyClient setup
const apifyClient = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

// Helper function to validate Quora URL
function isValidQuoraUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return (
            (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') &&
            parsedUrl.hostname.endsWith('quora.com')
        );
    } catch (error) {
        return false;
    }
}

// Helper function to auto-scroll pages (for Quora)
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

// Helper function for retrying Browserless connection
async function connectWithRetry(maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const browser = await puppeteer.connect({
                browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
            });
            return browser;
        } catch (error) {
            if (error.message.includes('429') && attempt < maxRetries) {
                console.warn(`Browserless 429 error, retrying (${attempt}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            throw error;
        }
    }
    throw new Error('Max retries reached for Browserless connection');
}

// Reddit Search Endpoint
app.get('/search', async (req, res) => {
    const query = req.query.query;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }

    try {
        const sixMonthsAgo = 1729814400; // Approx. Oct 25, 2024
        const searchResults = await r.search({ query: query, limit: 50 });
        const filteredPosts = searchResults.filter(post => post.created_utc >= sixMonthsAgo);

        const posts = filteredPosts.slice(0, 10).map(post => ({
            post_id: post.id,
            title: post.title,
            subreddit: post.subreddit.display_name,
            author: post.author.name,
            score: post.score,
            comments: post.num_comments,
            created_utc: post.created_utc,
            thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
            url: post.url,
            permalink: `https://www.reddit.com${post.permalink}`,
            is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
        }));
        res.json(posts);
    } catch (error) {
        console.error('Reddit search error:', error);
        res.status(500).json({ error: 'Failed to fetch search results from Reddit' });
    }
});

// Reddit Thread Endpoint
app.get('/thread', async (req, res) => {
    const postId = req.query.id;
    if (!postId) {
        return res.status(400).json({ error: 'Post ID is required' });
    }

    try {
        const sixMonthsAgo = 1729814400; // Approx. Oct 25, 2024
        const post = await r.getSubmission(postId).fetch();
        if (post.created_utc < sixMonthsAgo) {
            return res.status(404).json({ error: 'Post is older than 6 months' });
        }

        const comments = await post.comments.fetchMore({ amount: 50 });
        const filteredComments = comments.filter(comment => comment.created_utc >= sixMonthsAgo);

        const thread = {
            post_id: post.id,
            title: post.title,
            subreddit: post.subreddit.display_name,
            author: post.author.name,
            score: post.score,
            created_utc: post.created_utc,
            body: post.selftext || '',
            thumbnail: post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' ? post.thumbnail : null,
            url: post.url,
            is_image: post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.jpeg'),
            comments: filteredComments.slice(0, 10).map(comment => ({
                id: comment.id,
                author: comment.author.name,
                score: comment.score,
                created_utc: comment.created_utc,
                body: comment.body,
                permalink: `https://www.reddit.com${comment.permalink}`,
            })),
        };
        res.json(thread);
    } catch (error) {
        console.error('Reddit thread error:', error);
        res.status(500).json({ error: 'Failed to fetch thread details from Reddit' });
    }
});

// Quora Search Endpoint
app.get('/quora/search', async (req, res) => {
    const query = req.query.query;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }

    try {
        const searchQuery = `site:quora.com "${query}"`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}&dateRestrict=m6`;
        const response = await axios.get(url);

        if (response.status !== 200) {
            throw new Error(`Google API request failed with status ${response.status}: ${response.statusText}`);
        }

        const items = response.data.items || [];
        const results = items.map(item => ({
            title: item.title,
            permalink: item.link,
            snippet: item.snippet || '',
            answer_count: item.snippet.match(/\d+ Answers/i) ? parseInt(item.snippet.match(/\d+/)[0]) : 0,
        }));

        res.json(results);
    } catch (error) {
        console.error('Quora search error (Google API):', error.response ? error.response.data : error.message);
        res.status(500).json({
            error: 'Failed to fetch search results from Quora via Google API',
            details: error.response ? error.response.data : error.message,
        });
    }
});

// Quora Thread Endpoint
app.get('/quora/thread', async (req, res) => {
    const url = req.query.url;
    if (!url || url === 'undefined' || typeof url !== 'string') {
        console.error('Missing or invalid URL parameter:', url);
        return res.status(400).json({ error: 'Valid URL parameter is required' });
    }

    if (!isValidQuoraUrl(url)) {
        console.error('Invalid Quora URL:', url);
        return res.status(400).json({ error: 'Invalid or non-Quora URL provided' });
    }

    let browser;
    try {
        browser = await connectWithRetry();
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        await autoScroll(page);

        const thread = await page.evaluate(() => {
            const title = document.querySelector('h1')?.innerText || '';
            const answers = [];
            const answerElements = document.querySelectorAll('div.q-box > div > div > div > div > div > div > div > div > div > div:nth-child(2) > div > div > div > div > div > div > div');

            answerElements.forEach((element) => {
                const authorElement = element.querySelector('div > div > div > a > span > span');
                const author = authorElement ? authorElement.innerText : 'Anonymous';
                const answerTextElement = element.querySelector('div > div:nth-child(2) > div > div > span > span');
                const answerText = answerTextElement ? answerTextElement.innerText : '';

                if (answerText) {
                    answers.push({
                        author,
                        body: answerText,
                        url: window.location.href,
                    });
                }
            });

            return {
                title,
                url: window.location.href,
                answers,
            };
        });

        await browser.close();
        res.json(thread);
    } catch (error) {
        console.error('Quora thread error (Browserless):', error.message, 'URL:', url);
        if (error.message.includes('429')) {
            res.status(429).json({
                error: 'Service rebuilding... ',
                details: 'try again shortly.',
            });
        } else {
            res.status(500).json({
                error: 'Failed to fetch thread details from Quora',
                details: error.message,
            });
        }
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError.message);
            }
        }
    }
});

const NEWS_API_KEY = process.env.NEWS_API_KEY;

// Log the API key to verify it's loaded
console.log('NEWS_API_KEY:', process.env.NEWS_API_KEY);

// News Search Endpoint
app.get('/news/search', async (req, res) => {
  const query = req.query.query;
  const source = req.query.source; // Optional: specific news source
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    let url;
    const validSources = [
      'bbc-news',
      'forbes',
      'bloomberg',
      'cnn',
      'nbc-news',
      'yahoo-finance',
      'reuters',
      'business-insider',
      'the-wall-street-journal',
    ];

    if (source && validSources.includes(source)) {
      // Source-specific search
      url = `https://newsapi.org/v2/top-headlines?sources=${source}&q=${encodeURIComponent(
        query
      )}&apiKey=${NEWS_API_KEY}`;
    } else {
      // General search across all available sources
      url = `https://newsapi.org/v2/everything?sources=${validSources}&q=${encodeURIComponent(
        query
      )}&from=2025-04-01&sortBy=publishedAt&apiKey=${NEWS_API_KEY}`;
    }

    console.log('NewsAPI request URL:', url); // Debug the URL
    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(`NewsAPI request failed with status ${response.status}`);
    }

    const articles = response.data.articles || [];
    const results = articles.slice(0, 20).map((article) => ({
      title: article.title || 'No title',
      author: article.author || article.source.name || 'Unknown',
      published_date: article.publishedAt || null,
      thumbnail: article.urlToImage || null,
      url: article.url || null,
      snippet: article.description || article.content || 'No description available',
      source: article.source.name || 'Unknown',
    }));

    res.json(results);
  } catch (error) {
    console.error('News search error:', error.message, error.response?.data, error.response?.status);
    res.status(500).json({
      error: 'Failed to fetch news articles',
      details: error.response?.data?.message || error.message,
    });
  }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});