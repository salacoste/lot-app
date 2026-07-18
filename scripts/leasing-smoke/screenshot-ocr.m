#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: screenshot-ocr <png>\n");
      return 64;
    }

    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
    if (source == NULL) {
      fprintf(stderr, "cannot read screenshot\n");
      return 65;
    }
    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (image == NULL) {
      fprintf(stderr, "cannot decode screenshot\n");
      return 66;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    BOOL succeeded = [handler performRequests:@[ request ] error:&error];
    CGImageRelease(image);
    if (!succeeded) {
      fprintf(stderr, "Vision OCR failed: %s\n", error.localizedDescription.UTF8String);
      return 67;
    }

    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
      if (candidate != nil) printf("%s\n", candidate.string.UTF8String);
    }
  }
  return 0;
}
