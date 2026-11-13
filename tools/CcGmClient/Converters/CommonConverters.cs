using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace CcGmClient.Converters
{
    public class BoolToVisibilityConverter : IValueConverter
    {
        public bool Invert { get; set; }

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            bool val = value is true;
            if (Invert) val = !val;
            return val ? Visibility.Visible : Visibility.Collapsed;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }

    public class NullOrEmptyToVisibilityConverter : IValueConverter
    {
        public bool Invert { get; set; }

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            bool empty = value == null || (value is string s && string.IsNullOrWhiteSpace(s));
            bool visible = Invert ? empty : !empty;
            return visible ? Visibility.Visible : Visibility.Collapsed;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }

    public class NumberSignColorConverter : IValueConverter
    {
        private static readonly SolidColorBrush GreenBrush = new(Color.FromRgb(56, 211, 159));
        private static readonly SolidColorBrush RedBrush = new(Color.FromRgb(255, 94, 98));
        private static readonly SolidColorBrush MutedBrush = new(Color.FromRgb(142, 157, 181));

        static NumberSignColorConverter()
        {
            GreenBrush.Freeze();
            RedBrush.Freeze();
            MutedBrush.Freeze();
        }

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is long l)
            {
                if (l > 0) return GreenBrush;
                if (l < 0) return RedBrush;
            }
            if (value is int i)
            {
                if (i > 0) return GreenBrush;
                if (i < 0) return RedBrush;
            }
            if (value is double d)
            {
                if (d > 0) return GreenBrush;
                if (d < 0) return RedBrush;
            }
            return MutedBrush;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
