import fs from "fs";
import path from "path";

const directories = [
  // "./doordash",
  // "./youtube",
  "./ueno",
  // "./dropbox",
  // "./facebook",
  // "./instagram",
  // "./meta",
  // "./netflix",
  // "./stripe",
  // "./tiktok",
  // "./uber",
];

function addTxtFiles(directory) {
  // Read the directory
  const files = fs.readdirSync(directory);

  // Filter JSON files
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  // Process each JSON file
  jsonFiles.forEach((jsonFile) => {
    const jsonFilePath = path.join(directory, jsonFile);
    console.log(`Processing ${jsonFilePath}`);

    // Read JSON file
    const data = fs.readFileSync(jsonFilePath, "utf-8");
    let parsedData;

    try {
      parsedData = JSON.parse(data);
    } catch (error) {
      console.error(`Error parsing JSON file ${jsonFilePath}:`, error);
      return; // Skip this file if there's an error
    }

    // Extract LinkedIn URLs
    const linkedInUrls = parsedData
      .map((entry) => entry.linkedInUrl)
      .filter(Boolean);

    // Prepare text file path
    const txtFilePath = jsonFilePath.replace(".json", ".txt");

    // Check if the TXT file already exists
    if (fs.existsSync(txtFilePath)) {
      console.log(`Skipping creation of ${txtFilePath} as it already exists.`);
    } else {
      // Write LinkedIn URLs to text file
      fs.writeFileSync(txtFilePath, linkedInUrls.join("\n"));
      console.log(`Created ${txtFilePath}`);
    }
  });
}

// Process all specified directories
directories.forEach((directory) => {
  if (fs.existsSync(directory)) {
    addTxtFiles(directory);
  } else {
    console.warn(`Directory ${directory} does not exist.`);
  }
});
