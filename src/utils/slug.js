// utils/slug.js

function generateSlug(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .trim();
}

function buildCategoriesPath(categories = []) {
  return categories
    .map(c =>
      c
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim()
    )
    .filter(Boolean)
    .join("-");
}

module.exports = {
  generateSlug,
  buildCategoriesPath,
};
