import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { origin, destination } = await request.json();

    if (!origin?.lat || !origin?.lng || !destination) {
      return NextResponse.json({ error: 'origin {lat,lng} and destination required' }, { status: 400 });
    }

    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) {
      return NextResponse.json({ error: 'GOOGLE_MAPS_SERVER_KEY not configured' }, { status: 503 });
    }

    const originsParam = `${origin.lat},${origin.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsParam)}&destinations=${encodeURIComponent(destination)}&departure_time=now&units=imperial&key=${key}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' || !data.rows?.[0]?.elements?.[0]) {
      return NextResponse.json({ error: 'geocode_failed', details: data.status }, { status: 502 });
    }

    const element = data.rows[0].elements[0];
    if (element.status !== 'OK') {
      return NextResponse.json({ error: 'route_unavailable', details: element.status }, { status: 502 });
    }

    const seconds = element.duration_in_traffic?.value ?? element.duration?.value ?? 0;
    const duration_minutes = Math.max(1, Math.round(seconds / 60));
    const distance_miles = element.distance?.value ? +(element.distance.value / 1609.344).toFixed(1) : null;

    return NextResponse.json({
      duration_minutes,
      distance_miles,
      duration_text: element.duration_in_traffic?.text ?? element.duration?.text ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'eta_failed' }, { status: 500 });
  }
}
