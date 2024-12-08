/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */
import { events } from '@dropins/tools/event-bus.js';
import { initializers } from '@dropins/tools/initializer.js';
import * as productApi from '@dropins/storefront-pdp/api.js';
import { render as productRenderer } from '@dropins/storefront-pdp/render.js';
import ProductDetails from '@dropins/storefront-pdp/containers/ProductDetails.js';

// Libs
import {
  getProduct,
  getSkuFromUrl,
  setJsonLd,
  loadErrorPage, performCatalogServiceQuery, variantsQuery,
} from '../../scripts/commerce.js';
import { fetchPlaceholders } from '../../scripts/aem.js';

async function addToCart({
  sku, quantity, optionsUIDs, product,
}) {
  const { cartApi } = await import('../../../scripts/minicart/api.js');

  return cartApi.addToCart(sku, optionsUIDs, quantity, product);
}

async function setJsonLdProduct(product) {
  const {
    name, inStock, description, sku, urlKey, price, priceRange, images, attributes,
  } = product;
  const amount = priceRange?.minimum?.final?.amount || price?.final?.amount;
  const brand = attributes.find((attr) => attr.name === 'brand');

  // get variants
  const { variants } = (await performCatalogServiceQuery(variantsQuery, { sku }))?.variants
    || { variants: [] };

  const ldJson = {
    '@context': 'http://schema.org',
    '@type': 'Product',
    name,
    description,
    image: images[0]?.url,
    offers: [],
    productID: sku,
    brand: {
      '@type': 'Brand',
      name: brand?.value,
    },
    url: new URL(`/products/${urlKey}/${sku}`, window.location),
    sku,
    '@id': new URL(`/products/${urlKey}/${sku}`, window.location),
  };

  if (variants.length > 1) {
    ldJson.offers.push(...variants.map((variant) => ({
      '@type': 'Offer',
      name: variant.product.name,
      image: variant.product.images[0]?.url,
      price: variant.product.price.final.amount.value,
      priceCurrency: variant.product.price.final.amount.currency,
      availability: variant.product.inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
      sku: variant.product.sku,
    })));
  } else {
    ldJson.offers.push({
      '@type': 'Offer',
      price: amount?.value,
      priceCurrency: amount?.currency,
      availability: inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
    });
  }

  setJsonLd(ldJson, 'product');
}

function createMetaTag(property, content, type) {
  if (!property || !type) {
    return;
  }
  let meta = document.head.querySelector(`meta[${type}="${property}"]`);
  if (meta) {
    if (!content) {
      meta.remove();
      return;
    }
    meta.setAttribute(type, property);
    meta.setAttribute('content', content);
    return;
  }
  if (!content) {
    return;
  }
  meta = document.createElement('meta');
  meta.setAttribute(type, property);
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function setMetaTags(product) {
  if (!product) {
    return;
  }

  const price = product.priceRange
    ? product.priceRange.minimum.final.amount : product.price.final.amount;

  createMetaTag('title', product.metaTitle || product.name, 'name');
  createMetaTag('description', product.metaDescription, 'name');
  createMetaTag('keywords', product.metaKeyword, 'name');

  createMetaTag('og:type', 'product', 'property');
  createMetaTag('og:description', product.shortDescription, 'property');
  createMetaTag('og:title', product.metaTitle || product.name, 'property');
  createMetaTag('og:url', window.location.href, 'property');
  const mainImage = product?.images?.filter((image) => image.roles.includes('thumbnail'))[0];
  const metaImage = mainImage?.url || product?.images[0]?.url;
  createMetaTag('og:image', metaImage, 'property');
  createMetaTag('og:image:secure_url', metaImage, 'property');
  createMetaTag('product:price:amount', price.value, 'property');
  createMetaTag('product:price:currency', price.currency, 'property');
}

export default async function decorate(block) {
  const placeholders = await fetchPlaceholders();

  const { product } = window;
  if (!product) {
    await loadErrorPage();
    return Promise.reject();
  }

  const langDefinitions = {
    default: {
      ...placeholders,
    },
  };

  const models = {
    ProductDetails: {
      initialData: { ...product },
    },
  };

  // Initialize Dropins
  initializers.register(productApi.initialize, {
    langDefinitions,
    models,
  });

  events.on('eds/lcp', () => {
    if (!product) {
      return;
    }

    document.title = product.name;
    window.adobeDataLayer.push((dl) => {
      dl.push({
        productContext: {
          productId: parseInt(product.externalId, 10) || 0,
          ...product,
        },
      });
      dl.push({ event: 'product-page-view', eventInfo: { ...dl.getState() } });
    });

    document.querySelectorAll('.dropin-picker__select').forEach((select) => {
      const newElement = select.cloneNode(true);
      select.parentNode.replaceChild(newElement, select);

      newElement.addEventListener('change', (event) => {
        const { value } = event.target;
        const url = new URL(window.location);

        url.searchParams.set('optionUIDs', value);
        window.history.replaceState({}, '', url);
      });
    });
  }, { eager: true });

  // Render Containers
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        await productRenderer.render(ProductDetails, {
          sku: product.sku,
          carousel: {
            controls: {
              desktop: 'thumbnailsColumn',
              mobile: 'thumbnailsRow',
            },
            arrowsOnMainImage: true,
            peak: {
              mobile: true,
              desktop: false,
            },
            gap: 'small',
          },
          slots: {
            Actions: (ctx) => {
              // Add to Cart Button
              ctx.appendButton((next, state) => {
                const adding = state.get('adding');
                return {
                  text: adding
                    ? next.dictionary.Custom.AddingToCart?.label
                    : next.dictionary.PDP.Product.AddToCart?.label,
                  icon: 'Cart',
                  variant: 'primary',
                  disabled: adding || !next.data?.inStock || !next.valid,
                  onClick: async () => {
                    try {
                      state.set('adding', true);
                      await addToCart({
                        sku: next.values?.sku,
                        quantity: next.values?.quantity,
                        optionsUIDs: next.values?.optionsUIDs,
                        product: next.data,
                      });
                    } catch (error) {
                      console.error('Could not add to cart: ', error);
                    } finally {
                      state.set('adding', false);
                    }
                  },
                };
              });

              ctx.appendButton((next, state) => {
                const adding = state.get('adding');
                return ({
                  disabled: adding,
                  icon: 'Heart',
                  variant: 'secondary',
                  onClick: async () => {
                    try {
                      state.set('adding', true);
                      const { addToWishlist } = await import('../../scripts/wishlist/api.js');
                      await addToWishlist(next.values.sku);
                    } finally {
                      state.set('adding', false);
                    }
                  },
                });
              });
            },
          },
          useACDL: true,
        })(block);
      } catch (e) {
        console.error(e);
        await loadErrorPage();
      } finally {
        resolve();
      }
    }, 0);
  });
}
