/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */
import { events } from '@dropins/tools/event-bus.js';
import { initializers } from '@dropins/tools/initializer.js';
import * as productApi from '@dropins/storefront-pdp/api.js';
import { render as productRenderer } from '@dropins/storefront-pdp/render.js';
import ProductDetails from '@dropins/storefront-pdp/containers/ProductDetails.js';

// Libs
import {
  loadErrorPage,
} from '../../scripts/commerce.js';
import { fetchPlaceholders } from '../../scripts/aem.js';

async function addToCart({
  sku, quantity, optionsUIDs, product,
}) {
  const { cartApi } = await import('../../../scripts/minicart/api.js');

  return cartApi.addToCart(sku, optionsUIDs, quantity, product);
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
      PDP: {
        Product: {
          Incrementer: { label: placeholders.pdpProductIncrementer },
          OutOfStock: { label: placeholders.pdpProductOutofstock },
          AddToCart: { label: placeholders.pdpProductAddtocart },
          Details: { label: placeholders.pdpProductDetails },
          RegularPrice: { label: placeholders.pdpProductRegularprice },
          SpecialPrice: { label: placeholders.pdpProductSpecialprice },
          PriceRange: {
            From: { label: placeholders.pdpProductPricerangeFrom },
            To: { label: placeholders.pdpProductPricerangeTo },
          },
          Image: { label: placeholders.pdpProductImage },
        },
        Swatches: {
          Required: { label: placeholders.pdpSwatchesRequired },
        },
        Carousel: {
          label: placeholders.pdpCarousel,
          Next: { label: placeholders.pdpCarouselNext },
          Previous: { label: placeholders.pdpCarouselPrevious },
          Slide: { label: placeholders.pdpCarouselSlide },
          Controls: {
            label: placeholders.pdpCarouselControls,
            Button: { label: placeholders.pdpCarouselControlsButton },
          },
        },
        Overlay: {
          Close: { label: placeholders.pdpOverlayClose },
        },
      },
      Custom: {
        AddingToCart: { label: placeholders.pdpCustomAddingtocart },
      },
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
