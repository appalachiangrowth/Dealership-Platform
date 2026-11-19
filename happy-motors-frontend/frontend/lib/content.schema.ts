/**
 * SHARED WEBSITE CONTENT — one list of texts for every design (ported from platform/lib/content-schema.php).
 * The Website content editor shows exactly these fields. Every design reads the same keys, so text a dealer
 * writes once appears in whichever design is active. Defaults use {placeholders} filled from Business details.
 * Field types: head = headline (*stars* highlight, Enter = new line), para = paragraph ([text](link) allowed),
 * text = single line, img = image URL.
 */
export type ContentFieldType = 'head' | 'para' | 'text' | 'img';

export interface ContentField {
  key: string;
  type: ContentFieldType;
  label: string;
  default: string;
  hint: string;
}
export interface ContentSection {
  id: string;
  label: string;
  help: string;
  fields: ContentField[];
}
export interface ContentPage {
  id: string;
  label: string;
  icon: string;
  page: string;
  sections: ContentSection[];
}

export const CONTENT_SCHEMA: ContentPage[] = [
  {
    "id": "home",
    "label": "Home page",
    "icon": "home",
    "page": "home",
    "sections": [
      {
        "id": "home.hero",
        "label": "Welcome banner",
        "help": "The first thing visitors see at the top of your home page.",
        "fields": [
          {
            "key": "home.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Find Your Next Vehicle\nWith *Confidence*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Browse quality used cars, trucks and SUVs at {name}. Every vehicle is listed with real photos, mileage and pricing, so you can shop with confidence.",
            "hint": ""
          }
        ]
      },
      {
        "id": "home.why",
        "label": "Why choose us",
        "help": "Four short reasons to buy from you.",
        "fields": [
          {
            "key": "home.why.title",
            "type": "head",
            "label": "Section headline",
            "default": "Why Drivers Choose *{name}*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.why.text",
            "type": "para",
            "label": "Short introduction",
            "default": "{name} makes buying a pre-owned vehicle simple. Every listing shows real photos, mileage and the price up front, and our team is ready to answer your questions.",
            "hint": ""
          },
          {
            "key": "home.why.f1_title",
            "type": "text",
            "label": "Reason 1 — title",
            "default": "Quality Vehicles",
            "hint": ""
          },
          {
            "key": "home.why.f1_text",
            "type": "para",
            "label": "Reason 1 — text",
            "default": "Every vehicle is listed with clear photos and honest details.",
            "hint": ""
          },
          {
            "key": "home.why.f2_title",
            "type": "text",
            "label": "Reason 2 — title",
            "default": "Prices Up Front",
            "hint": ""
          },
          {
            "key": "home.why.f2_text",
            "type": "para",
            "label": "Reason 2 — text",
            "default": "See the price and mileage before you visit — no surprises.",
            "hint": ""
          },
          {
            "key": "home.why.f3_title",
            "type": "text",
            "label": "Reason 3 — title",
            "default": "Local Team",
            "hint": ""
          },
          {
            "key": "home.why.f3_text",
            "type": "para",
            "label": "Reason 3 — text",
            "default": "Talk with real people who know every vehicle on the lot.",
            "hint": ""
          },
          {
            "key": "home.why.f4_title",
            "type": "text",
            "label": "Reason 4 — title",
            "default": "Easy to Reach",
            "hint": ""
          },
          {
            "key": "home.why.f4_text",
            "type": "para",
            "label": "Reason 4 — text",
            "default": "Call, email or stop by — we are happy to help.",
            "hint": ""
          }
        ]
      },
      {
        "id": "home.featured",
        "label": "Featured vehicles",
        "help": "Heading above the vehicles you mark as “Featured” in Inventory.",
        "fields": [
          {
            "key": "home.featured.title",
            "type": "head",
            "label": "Section headline",
            "default": "Featured *Vehicles*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.featured.text",
            "type": "para",
            "label": "Short introduction",
            "default": "A few highlights from our current inventory. Availability changes quickly, so call to confirm.",
            "hint": ""
          }
        ]
      },
      {
        "id": "home.reviews",
        "label": "Customer reviews",
        "help": "Add up to three real reviews from your customers. Leave a review empty to hide it.",
        "fields": [
          {
            "key": "home.reviews.title",
            "type": "head",
            "label": "Section headline",
            "default": "What Our *Customers Say*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.reviews.text",
            "type": "para",
            "label": "Short introduction",
            "default": "Real words from drivers who found their next vehicle with us.",
            "hint": ""
          },
          {
            "key": "home.reviews.r1_text",
            "type": "para",
            "label": "Review 1 — what they said",
            "default": "Add a review from a happy customer here.",
            "hint": "Copy a real review, for example from Google."
          },
          {
            "key": "home.reviews.r1_name",
            "type": "text",
            "label": "Review 1 — customer name",
            "default": "Customer Name",
            "hint": "First name and last initial is fine, e.g. “Sarah M.”"
          },
          {
            "key": "home.reviews.r2_text",
            "type": "para",
            "label": "Review 2 — what they said",
            "default": "Add a second customer review here.",
            "hint": ""
          },
          {
            "key": "home.reviews.r2_name",
            "type": "text",
            "label": "Review 2 — customer name",
            "default": "Customer Name",
            "hint": ""
          },
          {
            "key": "home.reviews.r3_text",
            "type": "para",
            "label": "Review 3 — what they said",
            "default": "Add a third customer review here.",
            "hint": ""
          },
          {
            "key": "home.reviews.r3_name",
            "type": "text",
            "label": "Review 3 — customer name",
            "default": "Customer Name",
            "hint": ""
          }
        ]
      },
      {
        "id": "home.ready",
        "label": "Call to action",
        "help": "The banner that invites visitors to browse or get in touch.",
        "fields": [
          {
            "key": "home.ready.title",
            "type": "head",
            "label": "Headline",
            "default": "Ready to Find Your *Next Vehicle?*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.ready.text",
            "type": "para",
            "label": "Supporting sentence",
            "default": "Browse our current inventory online, then call or stop by to see your favorite in person.",
            "hint": ""
          }
        ]
      },
      {
        "id": "home.location",
        "label": "Location",
        "help": "Your address, phone and hours are added automatically from Business details.",
        "fields": [
          {
            "key": "home.location.title",
            "type": "head",
            "label": "Section headline",
            "default": "Visit Us in *{city_state}*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "home.location.text",
            "type": "para",
            "label": "Short introduction",
            "default": "Stop by to see our vehicles in person, or give us a call — we are happy to help.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "about",
    "label": "About page",
    "icon": "info",
    "page": "about",
    "sections": [
      {
        "id": "about.hero",
        "label": "Page banner",
        "help": "",
        "fields": [
          {
            "key": "about.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "About *{name}*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "about.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "A local dealership focused on quality vehicles, honest details and friendly service.",
            "hint": ""
          }
        ]
      },
      {
        "id": "about.story",
        "label": "Your story",
        "help": "Tell visitors who you are and what makes you different.",
        "fields": [
          {
            "key": "about.story.title",
            "type": "head",
            "label": "Headline",
            "default": "Our *Story*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "about.story.copy",
            "type": "para",
            "label": "First paragraph",
            "default": "{name} helps drivers in {city_state} find dependable pre-owned vehicles. We keep things simple: clear information, fair prices and a team that is easy to reach.",
            "hint": ""
          },
          {
            "key": "about.story.copy2",
            "type": "para",
            "label": "Second paragraph",
            "default": "Browse our inventory online at your own pace, then contact us about any vehicle — we are glad to answer questions and set up a visit.",
            "hint": ""
          }
        ]
      },
      {
        "id": "about.values",
        "label": "What we stand for",
        "help": "Three short values or promises.",
        "fields": [
          {
            "key": "about.values.title",
            "type": "head",
            "label": "Section headline",
            "default": "What You Can *Expect*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "about.values.v1_title",
            "type": "text",
            "label": "Value 1 — title",
            "default": "Honest Information",
            "hint": ""
          },
          {
            "key": "about.values.v1_text",
            "type": "para",
            "label": "Value 1 — text",
            "default": "Real photos, mileage and prices on every listing.",
            "hint": ""
          },
          {
            "key": "about.values.v2_title",
            "type": "text",
            "label": "Value 2 — title",
            "default": "Friendly Service",
            "hint": ""
          },
          {
            "key": "about.values.v2_text",
            "type": "para",
            "label": "Value 2 — text",
            "default": "A relaxed, no-pressure experience from first question to handover.",
            "hint": ""
          },
          {
            "key": "about.values.v3_title",
            "type": "text",
            "label": "Value 3 — title",
            "default": "Here to Help",
            "hint": ""
          },
          {
            "key": "about.values.v3_text",
            "type": "para",
            "label": "Value 3 — text",
            "default": "Questions about a vehicle? Our team is happy to help.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "contact",
    "label": "Contact page",
    "icon": "mail",
    "page": "contact",
    "sections": [
      {
        "id": "contact.hero",
        "label": "Page banner",
        "help": "Your phone, email, address and hours are added automatically from Business details.",
        "fields": [
          {
            "key": "contact.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Get in *Touch*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "contact.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Questions about a vehicle or want to schedule a visit? Send us a message or give us a call.",
            "hint": ""
          }
        ]
      },
      {
        "id": "contact.form",
        "label": "Message form",
        "help": "",
        "fields": [
          {
            "key": "contact.form.title",
            "type": "text",
            "label": "Form heading",
            "default": "How can we help?",
            "hint": ""
          },
          {
            "key": "contact.form.intro",
            "type": "para",
            "label": "Form introduction",
            "default": "Fill in the form and our team will get back to you as soon as possible.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "inventory",
    "label": "Inventory pages",
    "icon": "car",
    "page": "inventory",
    "sections": [
      {
        "id": "inventory.hero",
        "label": "All inventory",
        "help": "Banner on the main inventory page.",
        "fields": [
          {
            "key": "inventory.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Our *Inventory*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "inventory.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Browse every vehicle currently available at {name}. Use the filters to narrow your search.",
            "hint": ""
          }
        ]
      },
      {
        "id": "cars.hero",
        "label": "Used cars",
        "help": "",
        "fields": [
          {
            "key": "cars.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Used Cars for *Every Drive*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "cars.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "From everyday commuters to weekend drivers, browse the used cars available at {name}.",
            "hint": ""
          }
        ]
      },
      {
        "id": "sedans.hero",
        "label": "Sedans",
        "help": "",
        "fields": [
          {
            "key": "sedans.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Used *Sedans*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "sedans.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Comfortable, efficient sedans for commuting and everyday driving.",
            "hint": ""
          }
        ]
      },
      {
        "id": "suvs.hero",
        "label": "SUVs",
        "help": "",
        "fields": [
          {
            "key": "suvs.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Used *SUVs*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "suvs.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Room for family, gear and the road ahead — browse our SUVs.",
            "hint": ""
          }
        ]
      },
      {
        "id": "trucks.hero",
        "label": "Trucks",
        "help": "",
        "fields": [
          {
            "key": "trucks.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Used *Trucks*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "trucks.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Pickup trucks ready for work, towing and weekend adventures.",
            "hint": ""
          }
        ]
      },
      {
        "id": "wagons.hero",
        "label": "Wagons",
        "help": "",
        "fields": [
          {
            "key": "wagons.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "Used *Wagons*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "wagons.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Car-like comfort with extra space for cargo, pets and trips.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "blog",
    "label": "Blog page",
    "icon": "book",
    "page": "blog",
    "sections": [
      {
        "id": "blog.hero",
        "label": "Page banner",
        "help": "Articles themselves are written in Inventory → Blog posts.",
        "fields": [
          {
            "key": "blog.hero.title",
            "type": "head",
            "label": "Headline",
            "default": "News & *Buying Tips*",
            "hint": "Put *stars* around words to highlight them. Press Enter to start a new line."
          },
          {
            "key": "blog.hero.text",
            "type": "para",
            "label": "Intro sentence",
            "default": "Helpful articles and updates from the team at {name}.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "footer",
    "label": "Footer",
    "icon": "footer",
    "page": "home",
    "sections": [
      {
        "id": "home.footer",
        "label": "Footer",
        "help": "Shown at the bottom of every page, next to your logo.",
        "fields": [
          {
            "key": "home.footer.text",
            "type": "para",
            "label": "About text",
            "default": "Quality pre-owned vehicles in {city_state}. Browse online, then call or visit us.",
            "hint": ""
          }
        ]
      }
    ]
  },
  {
    "id": "seo",
    "label": "Google & sharing",
    "icon": "search",
    "page": "home",
    "sections": [
      {
        "id": "seo.home",
        "label": "Home page on Google",
        "help": "The title and description Google shows in search results. Keep titles under 60 characters and descriptions under 160.",
        "fields": [
          {
            "key": "seo.home.title",
            "type": "text",
            "label": "Title",
            "default": "Used Cars, Trucks & SUVs in {city_state} | {name}",
            "hint": ""
          },
          {
            "key": "seo.home.description",
            "type": "text",
            "label": "Description",
            "default": "Browse quality used cars, trucks and SUVs at {name} in {city_state}. See photos, prices and details online.",
            "hint": ""
          },
          {
            "key": "seo.home.share_image",
            "type": "img",
            "label": "Image when shared",
            "default": "",
            "hint": "Shown when your website link is shared on Facebook, WhatsApp and similar. 1200 × 630 pixels works best. Your logo is used if empty."
          }
        ]
      },
      {
        "id": "seo.inventory",
        "label": "Inventory page on Google",
        "help": "",
        "fields": [
          {
            "key": "seo.inventory.title",
            "type": "text",
            "label": "Title",
            "default": "Inventory | {name} — {city_state}",
            "hint": ""
          },
          {
            "key": "seo.inventory.description",
            "type": "text",
            "label": "Description",
            "default": "Browse the used cars, trucks and SUVs currently available at {name} in {city_state}.",
            "hint": ""
          }
        ]
      },
      {
        "id": "seo.about",
        "label": "About page on Google",
        "help": "",
        "fields": [
          {
            "key": "seo.about.title",
            "type": "text",
            "label": "Title",
            "default": "About {name} | {city_state}",
            "hint": ""
          },
          {
            "key": "seo.about.description",
            "type": "text",
            "label": "Description",
            "default": "Learn about {name}, a used vehicle dealership in {city_state}.",
            "hint": ""
          }
        ]
      },
      {
        "id": "seo.contact",
        "label": "Contact page on Google",
        "help": "",
        "fields": [
          {
            "key": "seo.contact.title",
            "type": "text",
            "label": "Title",
            "default": "Contact {name} | {city_state}",
            "hint": ""
          },
          {
            "key": "seo.contact.description",
            "type": "text",
            "label": "Description",
            "default": "Call, email or visit {name} in {city_state}. Ask about a vehicle or schedule a visit.",
            "hint": ""
          }
        ]
      },
      {
        "id": "seo.blog",
        "label": "Blog page on Google",
        "help": "",
        "fields": [
          {
            "key": "seo.blog.title",
            "type": "text",
            "label": "Title",
            "default": "Blog | {name}",
            "hint": ""
          },
          {
            "key": "seo.blog.description",
            "type": "text",
            "label": "Description",
            "default": "News and car buying tips from {name} in {city_state}.",
            "hint": ""
          }
        ]
      }
    ]
  }
];

export const CONTENT_FIELDS: Record<string, ContentField & { page: string; section: string }> = Object.fromEntries(
  CONTENT_SCHEMA.flatMap((p) => p.sections.flatMap((s) => s.fields.map((f) => [f.key, { ...f, page: p.id, section: s.id }]))),
);
