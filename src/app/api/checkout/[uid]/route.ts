import { createClient } from "@/prismicio";
import { asText } from "@prismicio/client";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  // Create Stripe client at request time (avoid reading secrets at module load time)
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      { error: "Missing Stripe API key (STRIPE_SECRET_KEY)" },
      { status: 500 },
    );
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-07-30.basil" });

  try {
    const { uid } = await params;

    if (!uid) {
      return NextResponse.json(
        { error: "Missing Product UID" },
        { status: 400 },
      );
    }

    const prismicClient = createClient();
    const product = await prismicClient.getByUID("product", uid);

    const name = product.data.name as string;
    const price = product.data.price as number;
    if (typeof price !== "number" || Number.isNaN(price)) {
      return NextResponse.json({ error: "Invalid product price" }, { status: 400 });
    }
    // Stripe expects integer amounts in the smallest currency unit (cents)
    const unitAmount = Math.round(price * 100);
    if (unitAmount <= 0) {
      return NextResponse.json({ error: "Invalid product price" }, { status: 400 });
    }
    const image = product.data.image?.url;
    const description = asText(product.data.description);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name,
              ...(description ? { description } : {}),
              ...(image ? { images: [image] } : {}),
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      // origin may be null during some environments; provide a safe fallback
      success_url: `${request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/`,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe session creation error", error);
    return NextResponse.json(
      { error: "Failed to create Stripe Session" },
      { status: 500 },
    );
  }
}
