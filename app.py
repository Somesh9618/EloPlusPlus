# pyrefly: ignore [missing-import]
from flask import Flask, render_template, request, redirect, url_for, flash, session
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)

@app.route("/", methods=["GET", "POST"])
def hello_world():
    if request.method == "POST":
        form_type = request.form.get("form_type")
        
        if form_type == "chess_link":
            chess_url = request.form.get("chess_url", "").strip()
            if chess_url:
                # Basic parsing to extract username from URL
                username = chess_url.split("/")[-1] or chess_url.split("/")[-2] or "User"
                session["chess_username"] = username
                flash(f"Successfully connected chess.com profile for player '{username}'!", "success")
            else:
                flash("Invalid Chess.com URL submitted.", "error")
                
        return redirect(url_for("hello_world"))
        
    return render_template("index.html")

@app.route("/profile")
def profile_page():
    connected_username = session.get("chess_username", None)
    return render_template("profile.html", connected_chess_username=connected_username)

if __name__ == "__main__":
    app.run(debug=True)
