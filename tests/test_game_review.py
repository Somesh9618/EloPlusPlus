import unittest
from app import app, parse_single_game

class TestGameReview(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_home_page_status(self):
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)

    def test_review_hub_route(self):
        response = self.app.get('/review')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Game Review', response.data)

    def test_parse_single_game_with_id_and_pgn(self):
        raw_game = {
            'url': 'https://www.chess.com/game/live/123456789',
            'time_class': 'blitz',
            'time_control': '180+2',
            'end_time': 1700000000,
            'white': {'username': 'somesh9618', 'rating': 1500, 'result': 'win'},
            'black': {'username': 'opponent123', 'rating': 1480, 'result': 'checkmated'},
            'pgn': '[Event "Live Chess"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 1-0',
            'accuracies': {'white': 87.5, 'black': 72.1}
        }
        parsed = parse_single_game(raw_game, 'somesh9618')
        self.assertEqual(parsed['id'], '123456789')
        self.assertEqual(parsed['color'], 'white')
        self.assertEqual(parsed['outcome'], 'win')
        self.assertEqual(parsed['user_rating'], 1500)
        self.assertEqual(parsed['opponent_rating'], 1480)
        self.assertEqual(parsed['user_accuracy'], 87.5)
        self.assertEqual(parsed['opponent_accuracy'], 72.1)
        self.assertIn('1. e4 e5', parsed['pgn'])

if __name__ == '__main__':
    unittest.main()
