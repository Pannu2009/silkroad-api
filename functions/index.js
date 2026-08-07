export async function onRequest(context) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Silkroad Online - Community & Game Server</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background-color: #0d0f12;
            color: #e0e6ed;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            width: 100%;
            background: #161a23;
            border: 1px solid #2a3142;
            border-radius: 12px;
            padding: 40px 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }

        h1 {
            color: #f39c12;
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        p.subtitle {
            color: #8a99ad;
            margin-bottom: 30px;
            font-size: 1.1rem;
        }

        .status-card {
            background: #1f2533;
            border-radius: 8px;
            padding: 20px;
            display: inline-flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 30px;
            border: 1px solid #2d364d;
        }

        .status-dot {
            width: 14px;
            height: 14px;
            background-color: #2ecc71;
            border-radius: 50%;
            box-shadow: 0 0 10px #2ecc71;
        }

        .status-text {
            font-size: 1.1rem;
            font-weight: 600;
        }

        .btn-group {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            padding: 12px 28px;
            border-radius: 6px;
            font-size: 1rem;
            font-weight: bold;
            text-decoration: none;
            transition: all 0.2s ease;
            cursor: pointer;
        }

        .btn-primary {
            background-color: #f39c12;
            color: #0d0f12;
        }

        .btn-primary:hover {
            background-color: #d6860f;
        }

        .btn-secondary {
            background-color: #5865F2;
            color: #fff;
        }

        .btn-secondary:hover {
            background-color: #4752C4;
        }

        footer {
            margin-top: 40px;
            color: #536278;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>

    <div class="container">
        <h1>Silkroad Online</h1>
        <p class="subtitle">Welcome to the official game hub and server community.</p>

        <div class="status-card">
            <div class="status-dot" id="statusDot"></div>
            <div class="status-text" id="statusText">Server Online | Players: <span id="playerCount">5</span></div>
        </div>

        <div class="btn-group">
            <a href="#" class="btn btn-primary">Download Client</a>
            <a href="#" class="btn btn-secondary">Join Discord</a>
        </div>
    </div>

    <footer>
        &copy; Silkroad Online Community. All rights reserved.
    </footer>

    <script>
        async function fetchServerStatus() {
            try {
                const res = await fetch('/api/status');
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('playerCount').innerText = data.playersOnline || 0;
                }
            } catch (err) {
                console.log('Status update check failed');
            }
        }
        setInterval(fetchServerStatus, 30000);
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

