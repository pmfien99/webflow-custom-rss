const path = require("path");
const AWS = require("aws-sdk");
const sanitizeHtml = require("sanitize-html");
const xml2js = require("xml2js");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const s3 = new AWS.S3({
  accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  region: process.env.MY_AWS_REGION,
});

const bucketName = process.env.MY_S3_BUCKET_NAME;
const rssFilePath = "rss.xml";

/**
 * Fetches a Webflow CMS item using the provided ID.
 *
 * @param {string} id - The Webflow ID of the item to be retrieved.
 * @returns {Promise<Object>} - The response data from Webflow as JSON.
 */
const getCollectionItem = async (id) => {
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${process.env.WEBFLOW_API_ACCESS_TOKEN}`,
    },
  };

  try {
    const response = await fetch(
      `https://api.webflow.com/beta/collections/${process.env.POST_COLLECTION_ID}/items/${id}`,
      options
    );
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("Error fetching collection item:", err);
    throw err;
  }
};

/**
 * Reads the existing RSS file from S3 and parses it into a JavaScript object.
 *
 * @returns {Promise<Object>} - The parsed RSS data.
 */
const readRSSFileFromS3 = async () => {
  try {
    const params = {
      Bucket: bucketName,
      Key: rssFilePath,
    };
    const data = await s3.getObject(params).promise();
    const rssData = data.Body.toString("utf-8");

    const parser = new xml2js.Parser({
      explicitArray: false,
      preserveChildrenOrder: true,
      charsAsChildren: false,
      cdata: true,
    });

    const parsedRSSData = await parser.parseStringPromise(rssData);

    // Ensure items array is initialized
    const items = parsedRSSData.rss.channel.item;
    parsedRSSData.rss.channel.item = items
      ? Array.isArray(items)
        ? items
        : [items]
      : [];

    return parsedRSSData;
  } catch (err) {
    console.error("Error fetching RSS from S3:", err);
    // Return a default RSS structure if the file doesn't exist or is malformed
    return {
      rss: {
        $: {
          version: "2.0",
          "xmlns:atom": "http://www.w3.org/2005/Atom",
          "xmlns:media": "http://search.yahoo.com/mrss/",
          "xmlns:content": "http://purl.org/rss/1.0/modules/content/",
        },
        channel: {
          title: "Website Channel Title",
          link: "https://www.google.com",
          description:
            "Website Channel Description",
          "atom:link": {
            $: {
              href: "https://webflow-rss.s3.us-east-2.amazonaws.com/rss.xml",
              rel: "self",
              type: "application/rss+xml",
            },
          },
          item: [],
        },
      },
    };
  }
};

/**
 * Writes the updated RSS data to S3.
 *
 * @param {Object} rssData - The RSS data object to be converted to XML and uploaded.
 * @returns {Promise<void>}
 */
const writeRSSFileToS3 = async (rssData) => {
  const builder = new xml2js.Builder({
    cdata: true,
    renderOpts: { pretty: true },
    headless: true,
  });

  const xml = builder.buildObject(rssData);

  const params = {
    Bucket: bucketName,
    Key: rssFilePath,
    Body: xml,
    ContentType: "application/rss+xml",
  };

  try {
    await s3.putObject(params).promise();
    console.log("RSS file updated successfully in S3");
  } catch (err) {
    console.error("Error writing RSS file to S3:", err);
    throw err;
  }
};

/**
 * Updates or adds an RSS feed item based on the provided post data.
 *
 * @param {Object} rssData - The current RSS data object.
 * @param {Object} postData - The post data retrieved from Webflow.
 * @returns {Promise<void>}
 */
const upsertRSSFeed = async (rssData, postData) => {

  // You'll have to customize this based on the needs of your RSS
  const postTitle = postData.fieldData.name;
  const postLink = `https://www.appsoc.com/blog/${postData.fieldData.slug}`;
  const postDescription = postData.fieldData["post-excerpt"];
  const postDate = new Date(postData.fieldData["post---posted-date"]).toUTCString();
  const postImageUrl = postData.fieldData["post-main-image"].url;
  let postBody = postData.fieldData["post-body"] || "No content available";

  // Sanitize the postBody
  postBody = sanitizeHtml(postBody, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h2",
      "ul",
      "li",
      "p",
      "strong",
      "a",
    ]),
    allowedAttributes: {
      a: ["href", "target", "id"],
      img: ["src", "alt"],
      p: ["id"],
      h2: ["id"],
      strong: ["id"],
    },
  });

  const rssItem = {
    title: postTitle,
    link: postLink,
    guid: postLink,
    description: postDescription,
    pubDate: postDate,
    "media:content": {
      $: {
        url: postImageUrl,
        medium: "image",
      },
    },
    "media:thumbnail": {
      $: {
        url: postImageUrl,
      },
    },
    "content:encoded": {
      $: {
        "xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      },
      _: postBody, 
    },
  };

  const existingItemIndex = rssData.rss.channel.item.findIndex(
    (item) => item.guid === postLink
  );

  if (existingItemIndex !== -1) {
    rssData.rss.channel.item[existingItemIndex] = rssItem;
  } else {
    rssData.rss.channel.item.push(rssItem);
  }

  rssData.rss.channel.item.sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );

  await writeRSSFileToS3(rssData);
};

/**
 * Deletes a blog post from the RSS feed based on the provided post ID.
 *
 * @param {Object} rssData - The current RSS data object.
 * @param {string} postId - The ID of the post to be deleted.
 * @returns {Promise<void>}
 */
const deleteRSSFeedItem = async (rssData, postId) => {
  const postLink = `https://www.appsoc.com/blog/${postId}`;

  const itemIndex = rssData.rss.channel.item.findIndex(
    (item) => item.guid === postLink
  );

  if (itemIndex !== -1) {
    rssData.rss.channel.item.splice(itemIndex, 1);
    console.log(`Post with ID ${postId} removed from RSS feed`);
  } else {
    console.log(`Post with ID ${postId} not found in RSS feed`);
  }

  await writeRSSFileToS3(rssData);
};

/**
 * Netlify Function handler to process webhooks related to blog posts and update the RSS feed accordingly.
 *
 * @param {Object} event - The Netlify function event payload.
 * @returns {Object} - The response object with statusCode and body.
 */
exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const { triggerType, payload } = body;

  try {
    const rssData = await readRSSFileFromS3();

    // POST_COLLECTION_ID is the id of the Webflow CMS collection of interest
    if (payload.collectionId === process.env.POST_COLLECTION_ID) {
      if (
        ["collection_item_created", "collection_item_changed"].includes(
          triggerType
        )
      ) {
        if (!payload.isArchived && !payload.isDraft) {
          const postData = await getCollectionItem(payload.id);
          await upsertRSSFeed(rssData, postData);
        }
      } else if (triggerType === "collection_item_deleted") {
        await deleteRSSFeedItem(rssData, payload.slug);
      }
    } else {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Non-blog post webhook received successfully!",
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Webhook received successfully!" }),
    };
  } catch (err) {
    console.error("Error processing webhook:", err);
    return {
      statusCode: 500,
      body: "Internal Server Error",
    };
  }
};
