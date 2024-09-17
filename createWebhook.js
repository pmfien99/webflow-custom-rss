const path = require("path");
const fetch = require('node-fetch');
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Webhook URL where the payload will be sent (e.g., your GitHub Action or Netlify function URL)
const webhookUrl = 'https://gorgeous-meerkat-9475ee.netlify.app/.netlify/functions/webhook-handler';
const webflowToken = process.env.WEBFLOW_API_ACCESS_TOKEN;
const webflowSiteId = process.env.WEBFLOW_SITE_ID;


// Create the Webflow webhook based on type
async function createWebhook(webhookType) {
  console.log("Creating Your Webhook: " + webhookType);

  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${webflowToken}`
    },
    body: JSON.stringify({triggerType: webhookType, url: webhookUrl})
  };
  
  fetch(`https://api.webflow.com/beta/sites/${webflowSiteId}/webhooks`, options)
    .then(response => response.json())
    .then(response => console.log(response))
    .catch(err => console.error(err));
}

createWebhook("collection_item_created");
createWebhook("collection_item_changed");
createWebhook("collection_item_deleted");
