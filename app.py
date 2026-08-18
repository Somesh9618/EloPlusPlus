# pyrefly: ignore [missing-import]
from flask import Flask, render_template, request, redirect, url_for, flash, session
from flask_caching import Cache
import os
import requests
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Cache API responses for 10 minutes (Chess.com updates at most every 12h)
cache = Cache(app, config={'CACHE_TYPE': 'SimpleCache', 'CACHE_DEFAULT_TIMEOUT': 600})

def parse_single_game(game, username):
    # Determine user color
    white_username = game.get('white', {}).get('username', '')
    black_username = game.get('black', {}).get('username', '')
    user_is_white = white_username.lower() == username.lower()
    
    user_color = 'white' if user_is_white else 'black'
    opponent = black_username if user_is_white else white_username
    
    user_result = game.get('white', {}).get('result', '') if user_is_white else game.get('black', {}).get('result', '')
    opponent_result = game.get('black', {}).get('result', '') if user_is_white else game.get('white', {}).get('result', '')
    
    # Determine outcome: win, loss, draw
    if user_result == 'win':
        outcome = 'win'
    elif user_result in ['checkmated', 'timeout', 'resigned', 'lose', 'abandoned']:
        outcome = 'loss'
    else:
        if opponent_result == 'win':
            outcome = 'loss'
        else:
            outcome = 'draw'
            
    end_time_val = game.get('end_time')
    date_str = ""
    if end_time_val:
        date_str = datetime.datetime.fromtimestamp(end_time_val).strftime('%Y-%m-%d')
        
    return {
        'url': game.get('url', '#'),
        'color': user_color,
        'opponent': opponent,
        'outcome': outcome,
        'result_code': user_result,
        'opponent_result_code': opponent_result,
        'date': date_str,
        'rating': game.get('white', {}).get('rating', 0) if user_is_white else game.get('black', {}).get('rating', 0),
        'time_control': game.get('time_control', ''),
        'time_class': game.get('time_class', '')
    }

def _fetch_archive(archive_url, headers):
    """Fetch a single monthly archive — called in parallel threads."""
    try:
        resp = requests.get(archive_url, headers=headers, timeout=8)
        if resp.status_code == 200:
            return resp.json().get("games", [])
    except Exception as e:
        print(f"Error fetching archive {archive_url}: {e}")
    return []

def fetch_recent_games_by_class(username, limit=20):
    headers = {'User-Agent': 'EloPlusPlus/1.0 (contact: admin@eloplusplus.com)'}
    blitz_games, rapid_games, bullet_games, all_recent_games = [], [], [], []

    try:
        archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
        r = requests.get(archives_url, headers=headers, timeout=8)
        if r.status_code != 200:
            return [], [], [], []

        archives = r.json().get("archives", [])
        if not archives:
            return [], [], [], []

        # Only look at the 3 most recent months in parallel — enough for 20 games each
        recent_archives = list(reversed(archives))[:3]

        with ThreadPoolExecutor(max_workers=3) as executor:
            future_to_url = {executor.submit(_fetch_archive, url, headers): url for url in recent_archives}
            month_games = []
            for future in as_completed(future_to_url):
                month_games.append((future_to_url[future], future.result()))

        # Sort by archive URL (newest first) and process
        month_games.sort(key=lambda x: x[0], reverse=True)
        for _, games in month_games:
            for game in reversed(games):
                time_class = game.get("time_class")
                parsed_game = parse_single_game(game, username)

                if len(all_recent_games) < limit:
                    all_recent_games.append(parsed_game)
                if time_class == 'blitz' and len(blitz_games) < limit:
                    blitz_games.append(parsed_game)
                elif time_class == 'rapid' and len(rapid_games) < limit:
                    rapid_games.append(parsed_game)
                elif time_class == 'bullet' and len(bullet_games) < limit:
                    bullet_games.append(parsed_game)

    except Exception as e:
        print(f"Error fetching games: {e}")

    return blitz_games, rapid_games, bullet_games, all_recent_games


@cache.memoize(timeout=600)
def fetch_all_chess_data(username):
    """Fetch profile, stats, and recent games in parallel. Result is cached 10 min per username."""
    headers = {'User-Agent': 'EloPlusPlus/1.0 (contact: admin@eloplusplus.com)'}
    profile_data, stats_data = {}, {}

    def _get_profile():
        try:
            r = requests.get(f"https://api.chess.com/pub/player/{username}", headers=headers, timeout=8)
            return r.json() if r.status_code == 200 else {}
        except Exception as e:
            print(f"Profile fetch error: {e}")
            return {}

    def _get_stats():
        try:
            r = requests.get(f"https://api.chess.com/pub/player/{username}/stats", headers=headers, timeout=8)
            return r.json() if r.status_code == 200 else {}
        except Exception as e:
            print(f"Stats fetch error: {e}")
            return {}

    # Fetch profile + stats in parallel, then games (needs archives first)
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_profile = executor.submit(_get_profile)
        f_stats = executor.submit(_get_stats)
        profile_data = f_profile.result()
        stats_data = f_stats.result()

    blitz_games, rapid_games, bullet_games, all_recent_games = fetch_recent_games_by_class(username)

    return profile_data, stats_data, blitz_games, rapid_games, bullet_games, all_recent_games

def analyze_games(games):
    if not games:
        return {
            'strengths': ["No recent game data available to analyze strengths."],
            'weaknesses': ["No recent game data available to analyze weaknesses."],
            'tips': ["Play more games to see dynamic improvement tips."],
            'resources': [{"title": "Chess.com Lessons", "url": "https://www.chess.com/lessons"}]
        }
        
    strengths = []
    weaknesses = []
    tips = []
    resources = []
    
    total_games = len(games)
    wins = [g for g in games if g['outcome'] == 'win']
    losses = [g for g in games if g['outcome'] == 'loss']
    
    white_games = [g for g in games if g['color'] == 'white']
    black_games = [g for g in games if g['color'] == 'black']
    
    white_wins = [g for g in white_games if g['outcome'] == 'win']
    black_wins = [g for g in black_games if g['outcome'] == 'win']
    
    white_win_rate = (len(white_wins) / len(white_games) * 100) if white_games else 0
    black_win_rate = (len(black_wins) / len(black_games) * 100) if black_games else 0
    
    win_rate = (len(wins) / total_games) * 100
    
    if white_win_rate >= 55:
        strengths.append(f"Commanding white repertoire: strong first-move advantage utilization ({white_win_rate:.0f}% win rate).")
    if black_win_rate >= 50:
        strengths.append(f"Resilient black play: high success rate counter-attacking ({black_win_rate:.0f}% win rate).")
        
    opponent_checkmated = [w for w in wins if w.get('opponent_result_code') == 'checkmated']
    opponent_resigned = [w for w in wins if w.get('opponent_result_code') == 'resigned']
    opponent_timeout = [w for w in wins if w.get('opponent_result_code') == 'timeout']
    
    if len(wins) > 0:
        mate_pct = (len(opponent_checkmated) / len(wins)) * 100
        resign_pct = (len(opponent_resigned) / len(wins)) * 100
        time_pct = (len(opponent_timeout) / len(wins)) * 100
        
        if mate_pct >= 35:
            strengths.append(f"Sharp attacking vision: high percentage of wins by checkmate ({mate_pct:.0f}% of wins).")
        if resign_pct >= 35:
            strengths.append(f"Strong positional pressure: forces opponents to resign under stress ({resign_pct:.0f}% of wins).")
        if time_pct >= 35:
            strengths.append(f"Excellent clock management: winning scrambles on time pressure ({time_pct:.0f}% of wins).")

    if not strengths:
        strengths.append(f"Solid general performance with a {win_rate:.0f}% win rate across recent matches.")
        
    loss_reasons = {}
    for l in losses:
        reason = l.get('result_code')
        loss_reasons[reason] = loss_reasons.get(reason, 0) + 1
        
    total_losses = len(losses)
    if total_losses > 0:
        checkmate_loss_pct = (loss_reasons.get('checkmated', 0) / total_losses) * 100
        timeout_loss_pct = (loss_reasons.get('timeout', 0) / total_losses) * 100
        
        if checkmate_loss_pct >= 35:
            weaknesses.append(f"Vulnerable to tactical blunders: {checkmate_loss_pct:.0f}% of losses are via checkmate. Watch out for king safety.")
            tips.append("King Safety: Always double check if your king is exposed, and avoid advancing pawns in front of a castled king without support.")
            resources.append({"title": "Chess.com King Safety Lessons", "url": "https://www.chess.com/lessons/king-safety"})
            
        if timeout_loss_pct >= 30:
            weaknesses.append(f"Time management struggles: {timeout_loss_pct:.0f}% of losses are due to running out of time.")
            tips.append("Time Scrambles: Try allocating a fixed budget per move and practice making quicker decisions, especially in blitz.")
            resources.append({"title": "Time Management Tips on Chess.com", "url": "https://www.chess.com/article/view/time-management-in-chess"})
            
    if black_games and black_win_rate < 35:
        weaknesses.append(f"Suboptimal black play: low win rate ({black_win_rate:.0f}%) when playing with the black pieces.")
        tips.append("Black Openings: Develop a solid, defensive opening repertoire as Black, such as the Caro-Kann Defense or the French Defense.")
        resources.append({"title": "Study Black Openings on Chess.com", "url": "https://www.chess.com/openings"})
        
    if not weaknesses:
        weaknesses.append("No critical weaknesses detected in recent games. Continue keeping a clean sheet!")
        tips.append("Continuous Learning: Keep analyzing games and practicing tactical puzzles to stay sharp.")
        resources.append({"title": "Practice Tactics Puzzles", "url": "https://www.chess.com/puzzles"})
        
    return {
        'strengths': strengths,
        'weaknesses': weaknesses,
        'tips': tips,
        'resources': resources
    }

@app.route("/", methods=["GET", "POST"])
def hello_world():
    if request.method == "POST":
        form_type = request.form.get("form_type")
        
        if form_type == "chess_link":
            chess_url = request.form.get("chess_url", "").strip()
            if chess_url:
                username = chess_url.split("/")[-1] or chess_url.split("/")[-2] or "User"
                session["chess_username"] = username
                flash(f"Successfully connected chess.com profile for player '{username}'!", "success")
                return redirect(url_for("profile_page"))
            else:
                flash("Invalid Chess.com URL submitted.", "error")
                return redirect(url_for("hello_world"))
                
        return redirect(url_for("hello_world"))
        
    return render_template("index.html")

@app.route("/profile")
def profile_page():
    username = session.get("chess_username", "Somesh9618")

    try:
        # All data fetched in parallel and cached per username for 10 minutes
        profile_data, stats_data, blitz_games, rapid_games, bullet_games, all_recent_games = fetch_all_chess_data(username)
    except Exception as e:
        print(f"Error fetching chess.com data: {e}")
        flash("Failed to fetch player data from Chess.com API.", "error")
        profile_data, stats_data = {}, {}
        blitz_games, rapid_games, bullet_games, all_recent_games = [], [], [], []
        
    # Extract details
    avatar_url = profile_data.get('avatar')
    player_name = profile_data.get('name', username)
    title = profile_data.get('title')
    
    joined_timestamp = profile_data.get('joined')
    joined_str = ""
    if joined_timestamp:
        joined_str = datetime.datetime.fromtimestamp(joined_timestamp).strftime('%b %Y')
    else:
        joined_str = "N/A"
        
    # Extract ratings
    blitz_stats = stats_data.get('chess_blitz', {})
    rapid_stats = stats_data.get('chess_rapid', {})
    bullet_stats = stats_data.get('chess_bullet', {})
    
    blitz_rating = blitz_stats.get('last', {}).get('rating', 'N/A')
    blitz_peak = blitz_stats.get('best', {}).get('rating', 'N/A')
    blitz_record = blitz_stats.get('record', {'win': 0, 'loss': 0, 'draw': 0})
    
    rapid_rating = rapid_stats.get('last', {}).get('rating', 'N/A')
    rapid_peak = rapid_stats.get('best', {}).get('rating', 'N/A')
    rapid_record = rapid_stats.get('record', {'win': 0, 'loss': 0, 'draw': 0})
    
    bullet_rating = bullet_stats.get('last', {}).get('rating', 'N/A')
    bullet_peak = bullet_stats.get('best', {}).get('rating', 'N/A')
    bullet_record = bullet_stats.get('record', {'win': 0, 'loss': 0, 'draw': 0})
    
    # Analyze recent games
    analysis = analyze_games(all_recent_games)
    
    return render_template(
        "profile.html",
        username=username,
        player_name=player_name,
        avatar_url=avatar_url,
        title=title,
        joined_str=joined_str,
        blitz_rating=blitz_rating,
        blitz_peak=blitz_peak,
        blitz_record=blitz_record,
        rapid_rating=rapid_rating,
        rapid_peak=rapid_peak,
        rapid_record=rapid_record,
        bullet_rating=bullet_rating,
        bullet_peak=bullet_peak,
        bullet_record=bullet_record,
        blitz_games=blitz_games,
        rapid_games=rapid_games,
        bullet_games=bullet_games,
        analysis=analysis
    )

if __name__ == "__main__":
    app.run(debug=True)
