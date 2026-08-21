/*
 * NUR GOODS theme behaviour.
 *
 * Dependency free, progressive enhancement only. Every interaction below has a
 * working no-JavaScript fallback: the cart drawer falls back to /cart, the
 * mobile menu links are real links, predictive search falls back to /search,
 * and variant selection falls back to a native form submission.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var moneyFormat = root.getAttribute("data-money-format") || "£{{amount}}";
  var routes = {
    cart: root.getAttribute("data-cart-url") || "/cart",
    predictive: root.getAttribute("data-predictive-url") || "/search/suggest",
  };

  function formatMoney(cents) {
    var value = (Number(cents || 0) / 100).toFixed(2);
    var parts = value.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var withDelimiter = parts.join(".");
    return moneyFormat
      .replace(/\{\{\s*amount\s*\}\}/g, withDelimiter)
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, parts[0])
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, withDelimiter.replace(".", ","))
      .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, parts[0]);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function on(selector, event, handler) {
    document.addEventListener(event, function (nativeEvent) {
      var target = nativeEvent.target instanceof Element ? nativeEvent.target.closest(selector) : null;
      if (target) handler(nativeEvent, target);
    });
  }

  /* ------------------------------------------------------------ Overlays */

  function openOverlay(node) {
    if (!node) return;
    node.hidden = false;
    document.body.classList.add("drawer-open");
    var focusable = node.querySelector("[data-autofocus], button, a[href], input");
    if (focusable) focusable.focus();
  }

  function closeOverlay(node) {
    if (!node) return;
    node.hidden = true;
    if (!document.querySelector(".drawer:not([hidden]), .mobile-menu:not([hidden])")) {
      document.body.classList.remove("drawer-open");
    }
  }

  on("[data-open-cart]", "click", function (event) {
    var drawer = document.querySelector("[data-cart-drawer]");
    if (!drawer) return; // no drawer rendered, let the /cart link work
    event.preventDefault();
    openOverlay(drawer);
    refreshCart();
  });

  on("[data-open-menu]", "click", function (event) {
    event.preventDefault();
    openOverlay(document.querySelector("[data-mobile-menu]"));
  });

  on("[data-close-overlay]", "click", function (event, target) {
    event.preventDefault();
    closeOverlay(target.closest(".drawer, .mobile-menu"));
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    var open = document.querySelector(".drawer:not([hidden]), .mobile-menu:not([hidden])");
    if (open) closeOverlay(open);
  });

  /* ---------------------------------------------------------------- Cart */

  function setCartCount(count) {
    document.querySelectorAll("[data-cart-count]").forEach(function (node) {
      node.textContent = String(count);
      node.hidden = count === 0;
    });
  }

  function renderCart(cart) {
    setCartCount(cart.item_count);
    var body = document.querySelector("[data-cart-lines]");
    var empty = document.querySelector("[data-cart-empty]");
    var foot = document.querySelector("[data-cart-foot]");
    if (!body) return;

    if (!cart.items || cart.items.length === 0) {
      body.innerHTML = "";
      if (empty) empty.hidden = false;
      if (foot) foot.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (foot) foot.hidden = false;

    body.innerHTML = cart.items
      .map(function (item) {
        var image = item.image
          ? '<img src="' + escapeHtml(item.image.replace(/(\.[a-z]+)(\?|$)/i, "_160x160$1$2")) +
            '" alt="" width="72" height="72" loading="lazy">'
          : '<span class="cart-line__placeholder" aria-hidden="true"></span>';
        var options =
          item.options_with_values && item.options_with_values.length
            ? '<p class="cart-line__opts">' +
              escapeHtml(
                item.options_with_values
                  .map(function (option) {
                    return option.value;
                  })
                  .join(" / ")
              ) +
              "</p>"
            : "";
        return (
          '<li class="cart-line" data-line-key="' + escapeHtml(item.key) + '">' +
          image +
          '<div class="cart-line__info">' +
          '<a class="cart-line__title" href="' + escapeHtml(item.url) + '">' + escapeHtml(item.product_title) + "</a>" +
          options +
          '<p class="cart-line__unit">' + formatMoney(item.final_price) + " each</p>" +
          '<div class="cart-line__row">' +
          '<div class="qty">' +
          '<button type="button" data-line-change="-1" aria-label="Decrease quantity">&minus;</button>' +
          "<span>" + item.quantity + "</span>" +
          '<button type="button" data-line-change="1" aria-label="Increase quantity">+</button>' +
          "</div>" +
          '<div class="cart-line__row" style="gap:.5rem">' +
          '<span class="price" style="font-size:.95rem">' + formatMoney(item.final_line_price) + "</span>" +
          '<button type="button" class="line-remove" data-line-remove aria-label="Remove item">&times;</button>' +
          "</div>" +
          "</div>" +
          "</div>" +
          "</li>"
        );
      })
      .join("");

    document.querySelectorAll("[data-cart-subtotal]").forEach(function (node) {
      node.textContent = formatMoney(cart.total_price);
    });
  }

  function refreshCart() {
    return fetch(routes.cart + ".js", { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.json();
      })
      .then(renderCart)
      .catch(function () {
        /* Network failure keeps the server rendered state, /cart still works. */
      });
  }

  function changeLine(key, quantity) {
    return fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: key, quantity: quantity }),
    })
      .then(function (response) {
        return response.json();
      })
      .then(renderCart)
      .catch(function () {
        window.location.href = routes.cart;
      });
  }

  on("[data-line-change]", "click", function (event, target) {
    var line = target.closest("[data-line-key]");
    if (!line) return;
    var current = Number(line.querySelector(".qty span").textContent) || 1;
    var next = current + Number(target.getAttribute("data-line-change"));
    changeLine(line.getAttribute("data-line-key"), Math.max(0, next));
  });

  on("[data-line-remove]", "click", function (event, target) {
    var line = target.closest("[data-line-key]");
    if (!line) return;
    changeLine(line.getAttribute("data-line-key"), 0);
  });

  on("[data-product-form]", "submit", function (event, form) {
    var drawer = document.querySelector("[data-cart-drawer]");
    if (!drawer) return; // fall back to the native form post
    event.preventDefault();
    var button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    fetch("/cart/add.js", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new FormData(form),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("add-to-cart-failed");
        return response.json();
      })
      .then(function () {
        openOverlay(drawer);
        return refreshCart();
      })
      .catch(function () {
        form.submit();
      })
      .finally(function () {
        if (button) button.disabled = false;
      });
  });

  /* -------------------------------------------------- Predictive search */

  function initPredictive(form) {
    var input = form.querySelector('input[type="search"]');
    var results = form.querySelector("[data-predictive-results]");
    if (!input || !results) return;
    var timer = null;

    function hide() {
      results.hidden = true;
      results.innerHTML = "";
    }

    input.addEventListener("input", function () {
      var term = input.value.trim();
      window.clearTimeout(timer);
      if (term.length < 2) {
        hide();
        return;
      }
      timer = window.setTimeout(function () {
        var url =
          routes.predictive +
          "?q=" + encodeURIComponent(term) +
          "&resources[type]=product,collection,article,page" +
          "&resources[limit]=6" +
          "&section_id=predictive-search";
        fetch(url, { headers: { Accept: "text/html" } })
          .then(function (response) {
            return response.text();
          })
          .then(function (html) {
            var parsed = new DOMParser().parseFromString(html, "text/html");
            var inner = parsed.querySelector("[data-predictive-inner]");
            if (!inner || !inner.innerHTML.trim()) {
              hide();
              return;
            }
            results.innerHTML = inner.innerHTML;
            results.hidden = false;
          })
          .catch(hide);
      }, 180);
    });

    input.addEventListener("blur", function () {
      window.setTimeout(hide, 160);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hide();
    });
  }

  document.querySelectorAll("[data-predictive-form]").forEach(initPredictive);

  /* ------------------------------------------------------ Category rail */

  document.querySelectorAll("[data-rail]").forEach(function (rail) {
    var scroller = rail.querySelector("[data-rail-track]");
    var prev = rail.querySelector("[data-rail-prev]");
    var next = rail.querySelector("[data-rail-next]");
    if (!scroller || !prev || !next) return;

    function sync() {
      prev.disabled = scroller.scrollLeft <= 4;
      next.disabled = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
    }
    function step(direction) {
      scroller.scrollBy({ left: direction * Math.round(scroller.clientWidth * 0.85), behavior: "smooth" });
    }
    prev.addEventListener("click", function () {
      step(-1);
    });
    next.addEventListener("click", function () {
      step(1);
    });
    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  });

  /* ----------------------------------------------------- Product gallery */

  document.querySelectorAll("[data-gallery]").forEach(function (gallery) {
    var stage = gallery.querySelector("[data-gallery-stage]");
    if (!stage) return;
    gallery.querySelectorAll("[data-gallery-thumb]").forEach(function (thumb) {
      thumb.addEventListener("click", function () {
        stage.src = thumb.getAttribute("data-full");
        stage.alt = thumb.getAttribute("data-alt") || "";
        gallery.querySelectorAll("[data-gallery-thumb]").forEach(function (other) {
          other.setAttribute("aria-current", other === thumb ? "true" : "false");
        });
      });
    });
  });

  /* --------------------------------------------------- Variant selection */

  document.querySelectorAll("[data-variant-picker]").forEach(function (picker) {
    var form = picker.closest("[data-product-form]") || document.querySelector("[data-product-form]");
    var dataNode = document.querySelector("[data-variant-json]");
    if (!form || !dataNode) return;

    var variants;
    try {
      variants = JSON.parse(dataNode.textContent);
    } catch (error) {
      return;
    }

    var idField = form.querySelector("[data-variant-id]");
    var submit = form.querySelector('[type="submit"]');
    var priceNode = document.querySelector("[data-price-current]");
    var compareNode = document.querySelector("[data-price-compare]");
    var availabilityNode = document.querySelector("[data-availability]");
    var skuNode = document.querySelector("[data-sku]");

    function selectedOptions() {
      return Array.prototype.map.call(picker.querySelectorAll("[data-option-index]"), function (group) {
        var checked = group.querySelector("input:checked");
        return checked ? checked.value : null;
      });
    }

    function update() {
      var chosen = selectedOptions();
      var match = variants.filter(function (variant) {
        return chosen.every(function (value, index) {
          return value === null || variant.options[index] === value;
        });
      })[0];

      if (idField && match) idField.value = match.id;
      if (submit) {
        submit.disabled = !match || !match.available;
        submit.textContent = !match
          ? "Unavailable"
          : match.available
            ? submit.getAttribute("data-default-label") || "Add to basket"
            : "Sold out";
      }
      if (match && priceNode) priceNode.textContent = formatMoney(match.price);
      if (compareNode) {
        var showCompare = match && match.compare_at_price && match.compare_at_price > match.price;
        compareNode.hidden = !showCompare;
        if (showCompare) {
          compareNode.querySelector("s").textContent = formatMoney(match.compare_at_price);
        }
      }
      if (availabilityNode && match) {
        availabilityNode.textContent = match.available ? "In stock and ready to ship" : "Currently unavailable";
      }
      if (skuNode && match) {
        skuNode.textContent = match.sku || "";
        skuNode.hidden = !match.sku;
      }
      if (match && window.history.replaceState) {
        var url = new URL(window.location.href);
        url.searchParams.set("variant", match.id);
        window.history.replaceState({}, "", url.toString());
      }
    }

    picker.addEventListener("change", update);
    update();
  });

  /* -------------------------------------------------- Collection toolbar */

  document.querySelectorAll("[data-auto-submit]").forEach(function (field) {
    field.addEventListener("change", function () {
      var form = field.closest("form");
      if (form) form.submit();
    });
  });

  refreshCart();
})();
