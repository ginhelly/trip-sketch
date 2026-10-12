<template>
  <svg
    class="app-logo"
    viewBox="0 0 176 40"
    role="img"
    aria-label="Trip Sketch"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="logo-bird" x1="4" y1="34" x2="40" y2="4" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#2563eb" />
        <stop offset="1" stop-color="#7dd3fc" />
      </linearGradient>
    </defs>

    <!-- Пунктир маршрута за птицей -->
    <path
      d="M1 38.5 C 8 38.5, 12 36, 17 32"
      fill="none"
      stroke="#60a5fa"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-dasharray="0.1 3.4"
      opacity="0.9"
    />

    <!-- Дальнее крыло -->
    <path
      d="M27 17 C 29 12, 33 8, 39 6 C 36 10, 35 14, 34 18 Z"
      fill="#1d4ed8"
      opacity="0.75"
    />

    <!-- Хвост с глубокой вилкой -->
    <path
      d="M20 22 L 1.5 22.5 L 11.5 25.2 L 3.5 34 L 21 26.5 Z"
      fill="url(#logo-bird)"
    />

    <!-- Тело и голова -->
    <path
      d="M12 24 C 17 19, 24 15.5, 31 15 C 34.5 14.8, 37 16, 39 18 C 36.5 18.2, 35 19.2, 33.5 20.5 C 29 25, 21 27.5, 12 24 Z"
      fill="url(#logo-bird)"
    />

    <!-- Ближнее крыло, отведённое назад и вверх -->
    <path
      d="M27 18 C 24 12, 18 6, 8 3 C 12 9, 14 14, 16 20 C 19.5 21, 23.5 20, 27 18 Z"
      fill="url(#logo-bird)"
    />
    <path
      d="M24.5 18.2 C 21 13.5, 17 9.5, 12 6.8"
      fill="none"
      stroke="#0b1120"
      stroke-width="0.9"
      stroke-linecap="round"
      opacity="0.55"
    />

    <!-- Глаз -->
    <circle cx="34.4" cy="17" r="0.9" fill="#0b1120" />

    <text
      x="48"
      y="26"
      fill="#f8fafc"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="22"
      font-weight="700"
      letter-spacing="0.2"
    >Trip<tspan fill="#7dd3fc" font-style="italic" font-weight="400"> Sketch</tspan></text>
  </svg>
</template>

<style scoped>
.app-logo {
  display: block;
  height: 30px;
  width: auto;
}
</style>
