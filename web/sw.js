// Pozwala korzystać z aplikacji bez internetu (np. na siłowni).
const VERSION = 'dziennik-f01d504ecd';
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const IMAGES = ["./img/Ab_Crunch_Machine.jpg", "./img/Ab_Roller.jpg", "./img/Arnold_Dumbbell_Press.jpg", "./img/Band_Assisted_Pull-Up.jpg", "./img/Band_Pull_Apart.jpg", "./img/Barbell_Bench_Press_-_Medium_Grip.jpg", "./img/Barbell_Curl.jpg", "./img/Barbell_Deadlift.jpg", "./img/Barbell_Glute_Bridge.jpg", "./img/Barbell_Hip_Thrust.jpg", "./img/Barbell_Incline_Bench_Press_-_Medium_Grip.jpg", "./img/Barbell_Shrug.jpg", "./img/Barbell_Squat.jpg", "./img/Barbell_Walking_Lunge.jpg", "./img/Battling_Ropes.jpg", "./img/Bench_Dips.jpg", "./img/Bent_Over_Barbell_Row.jpg", "./img/Bicycling_Stationary.jpg", "./img/Bodyweight_Squat.jpg", "./img/Butterfly.jpg", "./img/Cable_Crossover.jpg", "./img/Cable_Crunch.jpg", "./img/Cable_Rope_Overhead_Triceps_Extension.jpg", "./img/Calf_Press_On_The_Leg_Press_Machine.jpg", "./img/Chin-Up.jpg", "./img/Close-Grip_Barbell_Bench_Press.jpg", "./img/Concentration_Curls.jpg", "./img/Crunches.jpg", "./img/Dead_Bug.jpg", "./img/Decline_Barbell_Bench_Press.jpg", "./img/Dips_-_Chest_Version.jpg", "./img/Dips_-_Triceps_Version.jpg", "./img/Dumbbell_Alternate_Bicep_Curl.jpg", "./img/Dumbbell_Bench_Press.jpg", "./img/Dumbbell_Flyes.jpg", "./img/Dumbbell_Incline_Row.jpg", "./img/Dumbbell_Lunges.jpg", "./img/Dumbbell_Rear_Lunge.jpg", "./img/Dumbbell_Shrug.jpg", "./img/Dumbbell_Step_Ups.jpg", "./img/EZ-Bar_Curl.jpg", "./img/EZ-Bar_Skullcrusher.jpg", "./img/Elliptical_Trainer.jpg", "./img/External_Rotation_with_Cable.jpg", "./img/Face_Pull.jpg", "./img/Farmers_Walk.jpg", "./img/Front_Barbell_Squat.jpg", "./img/Front_Dumbbell_Raise.jpg", "./img/Goblet_Squat.jpg", "./img/Good_Morning.jpg", "./img/Hack_Squat.jpg", "./img/Hammer_Curls.jpg", "./img/Hanging_Leg_Raise.jpg", "./img/Hyperextensions_Back_Extensions.jpg", "./img/Incline_Dumbbell_Curl.jpg", "./img/Incline_Dumbbell_Flyes.jpg", "./img/Incline_Dumbbell_Press.jpg", "./img/Inverted_Row.jpg", "./img/Knee_Hip_Raise_On_Parallel_Bars.jpg", "./img/Leg_Extensions.jpg", "./img/Leg_Press.jpg", "./img/Leverage_Iso_Row.jpg", "./img/Lying_Leg_Curls.jpg", "./img/Machine_Bench_Press.jpg", "./img/Machine_Shoulder_Military_Press.jpg", "./img/Mountain_Climbers.jpg", "./img/One-Arm_Dumbbell_Row.jpg", "./img/One-Arm_Kettlebell_Swings.jpg", "./img/One-Legged_Cable_Kickback.jpg", "./img/Pallof_Press.jpg", "./img/Plank.jpg", "./img/Preacher_Curl.jpg", "./img/Pullups.jpg", "./img/Pushups.jpg", "./img/Reverse_Crunch.jpg", "./img/Reverse_Flyes.jpg", "./img/Reverse_Grip_Bent-Over_Rows.jpg", "./img/Reverse_Machine_Flyes.jpg", "./img/Romanian_Deadlift.jpg", "./img/Rope_Jumping.jpg", "./img/Rowing_Stationary.jpg", "./img/Running_Treadmill.jpg", "./img/Russian_Twist.jpg", "./img/Seated_Cable_Rows.jpg", "./img/Seated_Calf_Raise.jpg", "./img/Seated_Dumbbell_Press.jpg", "./img/Seated_Leg_Curl.jpg", "./img/Side_Bridge.jpg", "./img/Side_Lateral_Raise.jpg", "./img/Single_Leg_Glute_Bridge.jpg", "./img/Smith_Machine_Squat.jpg", "./img/Split_Squat_with_Dumbbells.jpg", "./img/Standing_Biceps_Cable_Curl.jpg", "./img/Standing_Calf_Raises.jpg", "./img/Standing_Dumbbell_Triceps_Extension.jpg", "./img/Standing_Low-Pulley_Deltoid_Raise.jpg", "./img/Standing_Military_Press.jpg", "./img/Stiff-Legged_Dumbbell_Deadlift.jpg", "./img/Straight-Arm_Dumbbell_Pullover.jpg", "./img/Straight-Arm_Pulldown.jpg", "./img/Sumo_Deadlift.jpg", "./img/T-Bar_Row_with_Handle.jpg", "./img/Thigh_Abductor.jpg", "./img/Thigh_Adductor.jpg", "./img/Trap_Bar_Deadlift.jpg", "./img/Tricep_Dumbbell_Kickback.jpg", "./img/Triceps_Pushdown.jpg", "./img/Triceps_Pushdown_-_Rope_Attachment.jpg", "./img/Upright_Barbell_Row.jpg", "./img/V-Bar_Pulldown.jpg", "./img/Wide-Grip_Lat_Pulldown.jpg"];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    await Promise.allSettled(IMAGES.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== 'fonts' && k !== 'libs').map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // Najpierw sieć (żeby dostać nową wersję), bez sieci zapisana kopia.
      event.respondWith((async () => {
        try {
          const res = await fetch(req);
          if (res.ok) { const cache = await caches.open(VERSION); cache.put('./index.html', res.clone()); }
          return res;
        } catch (e) {
          return (await caches.match('./index.html')) || Response.error();
        }
      })());
      return;
    }
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const cache = await caches.open(VERSION); cache.put(req, res.clone()); }
      return res;
    })());
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    // Biblioteka bazy danych: wersja w adresie się nie zmienia, więc wystarczy pamięć podręczna.
    event.respondWith((async () => {
      const cache = await caches.open('libs');
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open('fonts');
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
