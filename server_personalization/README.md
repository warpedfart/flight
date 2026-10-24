# Server personalization

Gives the server its own name and logo.

    python3 server_personalization/personalize.py

Needs Python 3 with Tkinter (the window) and Pillow (`pip install pillow`) for the logo.
No window? `python3 server_personalization/personalize.py --cli --name "My Server" --logo logo.png [--dry-run]`

It replaces the current name everywhere players see it (web pages, terms and privacy, in-game
messages, Discord bot, 2FA label) and rebuilds `public/logo.png` and `public/logo-square.png`
(the page logo and the browser icon) from one picture. The name in use is kept in `current.json`,
so a later run renames from the last name. The first original logos are kept in `backup/`.

Not changed: deploy scripts (service and `FLIGHT_*` variable names), game data, domains, the compiled
game client and installers. Restart the server afterwards. `git checkout .` undoes a run before you commit.
