const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', express.static(path.join(__dirname, '../client')));

// Helper function to parse label into name and percentage
const parseLabel = (label) => {
  const [name, percentagePart] = label.split("||").map((part) => part.trim());
  const percentage = parseInt(percentagePart.replace("%", ""), 10);
  return { name, percentage };
};

// Helper function to determine parent status based on progress
const determineParentStatus = (progress) => {
  if (progress === 0) return "Not Started";
  if (progress <= 25) return "Started";
  if (progress < 75) return "Working";
  if (progress < 100) return "Making Progress";
  return "Done";
};

// API endpoint to calculate parent progress and update parent status
app.post("/api/calculate-and-update-parent", async (req, res) => {
  const { req_data } = req.body;
  const subitemId = req.body?.payload?.inputFields?.itemId;
  
  if (!subitemId) {
    return res.status(400).send("subitemId is required.");
  }

  try {
    // GraphQL query to fetch board ID, and subitems with status and color
    const query = `
      query {
        items(ids: [${subitemId}]) {
          id
          board {
            id
            name
          }
          subitems {
            id
            name
            column_values {
              ... on StatusValue {
                id
                label
                label_style {
                  color
                }
              }
            }
          }
          column_values {
            ... on StatusValue {
              id
              label
              label_style {
                color
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      "https://api.monday.com/v2",
      { query },
      { headers: { Authorization: `Bearer ${process.env.MONDAY_API_KEY}` } }
    );

    const parentItem = response.data.data.items[0];
    if (!parentItem) {
      return res.status(404).send("No data was found in item.");
    }

    const subitems = parentItem.subitems || [];
    const parentStatusColumns = parentItem.column_values || [];

    // Step 1: Build a percentage dictionary from subitems' status columns
    const percentageDictionary = {};
    subitems.forEach((subitem) => {
      subitem.column_values.forEach((col) => {
        if (col.label && col.label_style?.color && col.label.includes("||")) {
          const parsed = parseLabel(col.label);
          percentageDictionary[col.label_style.color] = parsed.percentage;
        }
      });
    });

    // Step 2: Calculate progress considering all subitems
    let totalPercentage = 0;
    let countedSubitems = 0;

    for (const subitem of subitems) {
      const statusColumn = subitem.column_values.find((col) => col.label_style?.color);

      if (statusColumn) {
        const color = statusColumn.label_style.color;
        const percentage = percentageDictionary[color] || 0; // Default to 0% if not found in the dictionary
        totalPercentage += percentage;
      }

      countedSubitems += 1;
    }

    const progress = countedSubitems > 0 ? Math.round(totalPercentage / countedSubitems) : 0;

    // Step 3: Determine parent status based on progress
    const parentStatus = determineParentStatus(progress);

    // Step 4: Find the first status column in the parent item for updating
    const statusColumn = parentStatusColumns.find((col) => col.id && col.label_style?.color);
    if (!statusColumn) {
      return res.status(404).send("No status column found in the parent item.");
    }

    const statusColumnId = statusColumn.id;
    const boardId = parentItem.board.id;
    const parentItemId = parentItem.id;

    // Step 5: Update the parent item's status column
    const mutation = `
      mutation {
        change_simple_column_value(
          board_id: ${boardId},
          item_id: ${parentItemId},
          column_id: "${statusColumnId}",
          value: "${parentStatus}"
        ) {
          id
        }
      }
    `;    

    await axios.post(
      "https://api.monday.com/v2",
      { query: mutation },
      { headers: { Authorization: `Bearer ${process.env.MONDAY_API_KEY}` } }
    );

    res.json({ progress, parentStatus, message: "Parent status updated successfully." });
  } catch (error) {
    console.error("Error calculating and updating parent status:", error.response?.data || error.message);
    res.status(500).send("Error calculating and updating parent status");
  }
});

app.post("/api/update-webhook", async (req, res) => {
  const slackWebhookUrl = 'https://hooks.slack.com/services/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';
  
  const userId = req.body?.payload?.inputFields?.userId;
  const itemId = req.body?.payload?.inputFields?.itemId;

  if (!userId || !itemId) {
    return res.status(400).send({ error: 'userId and itemId are required fields.' });
  }

  const query = `
      query {
        items(ids: [${itemId}]) {
          id
    			name
        }
  			users(ids: [${userId}]) {
    			name
  			}	
      }
    `;

  const mondayAPIresponse = await axios.post(
    "https://api.monday.com/v2",
    { query },
    { headers: { Authorization: `Bearer ${process.env.MONDAY_API_KEY}` } }
  );

  const itemData = mondayAPIresponse.data.data.items[0];
  if (!itemData) {
    return res.status(404).send("No data was found for item.");
  }

  const userData = mondayAPIresponse.data.data.users[0];
  if (!userData) {
    return res.status(404).send("No data was found for user.");
  }  

  const payload = {
    text: `User \`${userData.name}\` started working on Item \`${itemData.name}\``
  };

  try {
    const response = await axios.post(slackWebhookUrl, payload);
    res.status(200).send({ message: 'Notification sent successfully.' });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).send({ error: 'Failed to send Slack notification.' });
  }
});

const PORT = process.env.PORT || 8033;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
