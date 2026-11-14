# Workout Tracker Pro

A simple, elegant workout tracking application built with vanilla HTML, CSS, and JavaScript.

## Features

- **Three-day workout split**: Day A, Day B, and Day C with different focus areas
- **Dynamic data loading**: Workout data stored in JSON format for easy editing
- **Rest timers**: Built-in rest timers between sets with audio alerts
- **Google Calendar integration**: Share your completed workouts to Google Calendar
- **Responsive design**: Works on desktop, tablet, and mobile devices
- **Dark mode UI**: Easy on the eyes during early morning or late evening workouts

## Project Structure

```
.
├── index.html          # Main application file
├── workouts.json       # Workout data (exercises, weights, sets, reps)
├── .gitignore         # Git ignore file
└── README.md          # This file
```

## How to Edit Your Workouts

### Option 1: Edit on GitHub (Recommended)

1. Go to your GitHub repository
2. Open `workouts.json`
3. Click the pencil icon (Edit)
4. Modify your workout data:
   - Weights
   - Sets and reps
   - Rest times
   - Exercise names
5. Commit changes (Ctrl+S or click "Commit changes")
6. Your live app will update automatically within 1-2 minutes

### Option 2: Edit Locally

1. Open `workouts.json` in a text editor
2. Make your changes
3. Save the file
4. Commit and push to GitHub:
   ```bash
   git add workouts.json
   git commit -m "Update workout weights"
   git push origin main
   ```

## JSON Data Structure

The `workouts.json` file follows this structure:

```json
{
  "days": {
    "A": {
      "focus": "基礎力量與核心穩定",
      "exercises": [
        {
          "name": "啞鈴臥推 (Bench)",
          "weight": 18,
          "unit": "kg",
          "sets": 3,
          "reps": 12,
          "restTime": "2:00",
          "badge": "0° 平躺",
          "angleTag": null,
          "color": "normal"
        }
      ]
    }
  }
}
```

### Exercise Properties

- **name**: Exercise name (supports any language)
- **weight**: Weight value (number)
- **unit**: Unit (kg, lbs, etc.)
- **sets**: Number of sets
- **reps**: Number of repetitions
- **restTime**: Rest time between sets (format: "M:SS" or "SS")
- **badge**: Optional badge text (e.g., angle, position)
- **angleTag**: Optional angle indicator that appears in yellow (e.g., "25°")
- **color**: Text color - "normal" (white) or "highlight" (orange)

## Using the App

### Daily Use

1. Open the app in your browser
2. Select the workout day (A, B, or C)
3. Complete each exercise set by set
4. Use the "Set X" buttons to start rest timers
5. When all sets are complete, share to Google Calendar if desired

### URL Parameters

You can directly link to a specific day:

```
https://your-app-url.com?day=A
https://your-app-url.com?day=B
https://your-app-url.com?day=C
```

### Rest Timers

- Click the "Set X" button to start a timer
- Timer counts down with audio beep notification
- When the last set is completed, a completion dialog appears
- Complete your workout and optionally share to Google Calendar

## Deployment

### Netlify (Current)

1. Connect your GitHub repository to Netlify
2. Configure build settings:
   - Build command: (empty)
   - Publish directory: /
3. Deploy!
4. Each GitHub push triggers automatic deployment

### GitHub Pages

1. Go to repository Settings > Pages
2. Select source: "Deploy from a branch"
3. Choose branch: main, folder: root
4. Save and wait for deployment

## Training Tips

- Focus on form quality over weight, especially on busy days
- Increase weight by 1-2kg when exercises feel easy
- Stretch chest and hip flexors after workouts
- Use the rest timers to maintain consistent workout pace

## Browser Support

- Chrome (desktop & mobile)
- Safari (desktop & mobile)
- Firefox
- Edge

## Browser Support

- Chrome (desktop & mobile)
- Safari (desktop & mobile)
- Firefox
- Edge

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Styling**: Tailwind CSS (via CDN)
- **Data**: JSON
- **Hosting**: Netlify or GitHub Pages
- **Version Control**: Git/GitHub

## Version History

Track your workout progress through Git history! Every change to `workouts.json` is recorded, allowing you to:
- See when you increased weights
- Track your progression over time
- Revert to previous workout configurations if needed

## Screenshots

*Add screenshots here to show your app in action*

## Contributing

This is a personal workout tracker, but feel free to fork and adapt for your own needs!

## License

This project is open source and available under the MIT License.
